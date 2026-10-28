import { Injectable, Logger } from '@nestjs/common';
import {
  type AudienceRules,
  type AudienceSizeDto,
  audienceRulesSchema,
  DomainError,
  type SegmentResultDto,
  tiyinToSoum,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { isPurchase, revenueOf } from '../admin/analytics/sql';
import { PrismaService } from '../prisma/prisma.service';
import { compileAudience, previewSql } from './compile';

const DAY_MS = 86_400_000;
/** Leavers are kept this long for the 30-day result, then purged. */
const REMOVED_RETENTION_DAYS = 90;
export const RESULT_DAYS = 30;

export interface RefreshResult {
  size: number;
  added: number;
  removed: number;
}

/**
 * Segment sizes and membership (CLAUDE.md §6 "Audiences"). Preview and refresh share
 * `compileAudience`, so a preview number is exactly what a refresh would store.
 */
@Injectable()
export class AudienceService {
  private readonly logger = new Logger('Audiences');

  constructor(private readonly prisma: PrismaService) {}

  /** Product ids referenced by the rules must exist (else the rule silently never matches). */
  async assertProducts(rules: AudienceRules): Promise<void> {
    const ids = new Set<string>();
    for (const g of rules.groups)
      for (const c of g.conditions) if (c.type === 'product') ids.add(c.productId);
    if (!ids.size) return;
    const found = await this.prisma.product.count({ where: { id: { in: [...ids] } } });
    if (found !== ids.size) throw new DomainError('AUDIENCE_PRODUCT_NOT_FOUND');
  }

  async preview(rules: AudienceRules, now = new Date()): Promise<AudienceSizeDto> {
    const [row] = await this.prisma.$queryRaw<AudienceSizeDto[]>(previewSql(rules, now));
    return row ?? { total: 0, withPhone: 0, withTelegram: 0, adsReady: 0 };
  }

  /** Member ids right now (tests and diagnostics use the same compiled query). */
  async memberIds(rules: AudienceRules, now = new Date()): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(compileAudience(rules, now));
    return rows.map((r) => r.id);
  }

  /**
   * Re-evaluates one segment and stores the diff under the segment row lock: joiners inserted
   * (or a former member's row reopened), leavers marked `removedAt`, counters on the segment.
   */
  async refresh(segmentId: string, now = new Date()): Promise<RefreshResult | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [seg] = await tx.$queryRaw<{ rules: unknown; active: boolean }[]>`
            SELECT rules, active FROM "Segment" WHERE id = ${segmentId} FOR UPDATE`;
          if (!seg) return null;
          const parsed = audienceRulesSchema.safeParse(seg.rules);
          if (!parsed.success) throw new Error('stored rules are invalid');
          await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`;
          await tx.$executeRaw`DROP TABLE IF EXISTS _audience_members`;
          await tx.$executeRaw`CREATE TEMP TABLE _audience_members ON COMMIT DROP AS ${compileAudience(parsed.data, now)}`;
          const added = await tx.$executeRaw`
            INSERT INTO "SegmentMember" ("segmentId", "customerId", "addedAt", "removedAt")
            SELECT ${segmentId}, m.id, ${now}, NULL FROM _audience_members m
            ON CONFLICT ("segmentId", "customerId") DO UPDATE
              SET "addedAt" = EXCLUDED."addedAt", "removedAt" = NULL
              WHERE "SegmentMember"."removedAt" IS NOT NULL`;
          const removed = await tx.$executeRaw`
            UPDATE "SegmentMember" sm SET "removedAt" = ${now}
            WHERE sm."segmentId" = ${segmentId} AND sm."removedAt" IS NULL
              AND NOT EXISTS (SELECT 1 FROM _audience_members m WHERE m.id = sm."customerId")`;
          await tx.$executeRaw`
            DELETE FROM "SegmentMember" WHERE "segmentId" = ${segmentId}
              AND "removedAt" < ${new Date(now.getTime() - REMOVED_RETENTION_DAYS * DAY_MS)}`;
          const [count] = await tx.$queryRaw<{ n: number }[]>`
            SELECT COUNT(*)::int AS n FROM _audience_members`;
          const size = count?.n ?? 0;
          await tx.segment.update({
            where: { id: segmentId },
            data: {
              size,
              refreshedAt: now,
              refreshError: null,
              lastAdded: added,
              lastRemoved: removed,
            },
          });
          return { size, added, removed };
        },
        { timeout: 150_000 },
      );
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      this.logger.error(`segment ${segmentId} refresh failed: ${message}`);
      await this.prisma.segment
        .update({ where: { id: segmentId }, data: { refreshError: message } })
        .catch(() => undefined);
      throw e;
    }
  }

  /**
   * 30-day result: members whose membership overlapped the window; converted = a purchase
   * created after joining and before leaving; revenue = those purchases.
   */
  async result(segmentId: string, now = new Date()): Promise<SegmentResultDto> {
    const from = new Date(now.getTime() - RESULT_DAYS * DAY_MS);
    const [row] = await this.prisma.$queryRaw<
      { members: number; converted: number; revenue: bigint | null }[]
    >(Prisma.sql`
      WITH mem AS (
        SELECT sm."customerId", sm."addedAt", sm."removedAt" FROM "SegmentMember" sm
        WHERE sm."segmentId" = ${segmentId} AND (sm."removedAt" IS NULL OR sm."removedAt" >= ${from})
      ),
      conv AS (
        SELECT mem."customerId", SUM(${revenueOf('o')}) AS revenue
        FROM mem JOIN "Order" o ON o."customerId" = mem."customerId"
        WHERE o."createdAt" >= GREATEST(mem."addedAt", ${from})
          AND (mem."removedAt" IS NULL OR o."createdAt" <= mem."removedAt")
          AND ${isPurchase('o')}
        GROUP BY mem."customerId"
      )
      SELECT (SELECT COUNT(*) FROM mem)::int AS members,
             (SELECT COUNT(*) FROM conv)::int AS converted,
             (SELECT SUM(revenue) FROM conv)::bigint AS revenue`);
    const members = row?.members ?? 0;
    const converted = row?.converted ?? 0;
    return {
      periodDays: RESULT_DAYS,
      members,
      converted,
      crPct: members ? Math.round((converted / members) * 1000) / 10 : null,
      revenueSoum: tiyinToSoum(row?.revenue ?? 0n),
    };
  }
}
