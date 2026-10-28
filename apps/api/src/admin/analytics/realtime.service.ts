import { REALTIME_WINDOW_MINUTES, type RealtimeDto } from '@forest/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { num } from './sql';

/** Redis keys written by the ingest (Phase 4 shared brief): who is on the site right now. */
export const RT_SESSIONS = 'rt:sessions';
export const rtSessionKey = (id: string) => `rt:session:${id}`;

/** Most sessions read per request (the count itself is exact). */
const MAX_LIVE_SESSIONS = 2000;

function top(values: (string | undefined)[], n: number) {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v && v.trim() ? v : '—';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** A2 Real-time and the A1 "N kishi hozir saytda" badge. */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private windowStart(now: Date): number {
    return now.getTime() - REALTIME_WINDOW_MINUTES * 60_000;
  }

  /** Sessions seen in the last 30 minutes. */
  async activeNow(now = new Date()): Promise<number> {
    return this.redis.zcount(RT_SESSIONS, this.windowStart(now), '+inf');
  }

  async snapshot(now = new Date()): Promise<RealtimeDto> {
    const since = this.windowStart(now);
    const [activeNow, ids, perMinute] = await Promise.all([
      this.activeNow(now),
      this.redis.zrevrangebyscore(RT_SESSIONS, '+inf', since, 'LIMIT', 0, MAX_LIVE_SESSIONS),
      this.prisma.$queryRaw<{ minute: Date; sessions: bigint }[]>`
        SELECT date_trunc('minute', e.ts) AS minute, count(DISTINCT e."sessionId") AS sessions
        FROM "Event" e
        WHERE e.ts >= ${new Date(since)} AND e.ts <= ${now}
        GROUP BY 1`,
    ]);
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(rtSessionKey(id));
    const live = ((await pipeline.exec()) ?? [])
      .map(([err, value]) => (err ? null : (value as Record<string, string>)))
      .filter((v): v is Record<string, string> => !!v && Object.keys(v).length > 0);

    const minuteMs = 60_000;
    const lastMinute = Math.floor(now.getTime() / minuteMs) * minuteMs;
    const byMinute = new Map(perMinute.map((m) => [m.minute.getTime(), num(m.sessions)]));
    return {
      activeNow,
      perMinute: Array.from({ length: REALTIME_WINDOW_MINUTES }, (_, i) => {
        const t = lastMinute - (REALTIME_WINDOW_MINUTES - 1 - i) * minuteMs;
        return { minute: new Date(t).toISOString(), sessions: byMinute.get(t) ?? 0 };
      }),
      pages: top(
        live.map((s) => s.path),
        8,
      ).map(([path, sessions]) => ({ path, sessions })),
      channels: top(
        live.map((s) => s.channel),
        8,
      ).map(([channel, sessions]) => ({ channel, sessions })),
      regions: top(
        live.map((s) => s.region),
        8,
      ).map(([region, sessions]) => ({ region, sessions })),
    };
  }
}
