import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 404-log bounds (A9 "404 xatolar"): rare old misses go, the log never outgrows the top N. */
export const NOT_FOUND_RETENTION = { keep: 5_000, staleDays: 90, staleMaxHits: 3 } as const;

@Injectable()
export class NotFoundLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Job `seo.notfound.prune`: returns the number of rows removed. */
  async prune(now = new Date()): Promise<number> {
    const { keep, staleDays, staleMaxHits } = NOT_FOUND_RETENTION;
    const before = new Date(now.getTime() - staleDays * 86_400_000);
    const stale = await this.prisma.notFoundLog.deleteMany({
      where: { lastSeen: { lt: before }, hits: { lt: staleMaxHits } },
    });
    const overflow = await this.prisma.$executeRaw`
      DELETE FROM "NotFoundLog" WHERE "path" NOT IN (
        SELECT "path" FROM "NotFoundLog" ORDER BY "hits" DESC, "lastSeen" DESC LIMIT ${keep}
      )`;
    return stale.count + overflow;
  }
}
