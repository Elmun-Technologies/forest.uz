import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@forest/db';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const TRACKING_QUEUE = 'tracking';
export const BACKFILL_JOB = 'tracking.identity.backfill';
/** Event rows stamped per statement; the job loops until none are left. */
export const BACKFILL_CHUNK = 5000;

/**
 * Identity stitching (docs/07): the anonymous visitor (`fr_aid`) ↔ customer link, made on OTP /
 * Telegram login, checkout and lead capture. Past anonymous sessions of the visitor are
 * re-attributed to the customer (journey completeness, A5/A7).
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger('Identity');

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRACKING_QUEUE) private readonly queue: Queue,
  ) {}

  /** Never throws: identification is a side effect of the calling request. */
  async link(anonymousId: string | null, customerId: string): Promise<void> {
    if (!anonymousId) return;
    try {
      const now = new Date();
      const visitor = await this.prisma.visitor.upsert({
        where: { anonymousId },
        create: { anonymousId, customerId, firstSeenAt: now, lastSeenAt: now },
        // Latest identity wins on a shared device; sessions already stamped keep theirs.
        update: { customerId },
        select: { firstTouch: true, lastTouch: true },
      });
      const sessions = await this.prisma.session.updateMany({
        where: { anonymousId, customerId: null },
        data: { customerId },
      });
      await this.copyTouches(customerId, visitor.firstTouch, visitor.lastTouch);
      if (sessions.count > 0)
        await this.queue.add(
          BACKFILL_JOB,
          { anonymousId, customerId },
          { jobId: `backfill-${anonymousId}-${customerId}`, removeOnComplete: true },
        );
    } catch (e) {
      this.logger.warn(`identity link failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Customer.firstTouch (when empty) / lastTouch from the visitor (admin "first source", A4). */
  private async copyTouches(
    customerId: string,
    first: Prisma.JsonValue | null,
    last: Prisma.JsonValue | null,
  ): Promise<void> {
    if (!first && !last) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstTouch: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) return;
    const data: Prisma.CustomerUpdateInput = {};
    if (!customer.firstTouch && first) data.firstTouch = first as Prisma.InputJsonValue;
    if (last) data.lastTouch = last as Prisma.InputJsonValue;
    if (Object.keys(data).length)
      await this.prisma.customer.update({ where: { id: customerId }, data });
  }

  /**
   * Job: stamps the Event rows of the visitor's sessions now owned by the customer, in chunks
   * (Event has no anonymousId index; `sessionId` is indexed). Returns rows updated.
   */
  async backfill(anonymousId: string, customerId: string): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: { anonymousId, customerId },
      select: { id: true, startedAt: true },
    });
    if (!sessions.length) return 0;
    const ids = sessions.map((s) => s.id);
    // Events of a session are never older than its start (ingest clamps to the last hour):
    // bounding ts lets Postgres skip older monthly partitions.
    const since = new Date(Math.min(...sessions.map((s) => s.startedAt.getTime())) - 3600_000);
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        UPDATE "Event" SET "customerId" = ${customerId}
        WHERE ("id", "ts") IN (
          SELECT "id", "ts" FROM "Event"
          WHERE "sessionId" IN (${Prisma.join(ids)}) AND "customerId" IS NULL
            AND "ts" >= ${since}
          LIMIT ${BACKFILL_CHUNK})
        AND "ts" >= ${since}`;
      total += n;
      if (n < BACKFILL_CHUNK) return total;
    }
  }
}
