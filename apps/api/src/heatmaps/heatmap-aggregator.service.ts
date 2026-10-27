import { Injectable } from '@nestjs/common';
import { HEATMAP_INSIGHT_RULES, HEATMAP_X_STEP, HEATMAP_Y_STEP } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { dateColumn, lastDays } from './heatmap-days';

export const AGGREGATED_AT_KEY = 'heatmaps:aggregatedAt';

/** A click is an "exit" only once its session has been idle this long (the session is over). */
const SESSION_IDLE_MS = 30 * 60_000;
/** Events after the day's end that still decide whether a late click was the last one. */
const LOOKAHEAD = Prisma.sql`interval '1 hour'`;

/**
 * Locale-less pathname, same as `normalizeHeatmapPath` (contracts): no query/hash, no `/uz|/ru`
 * prefix, no trailing slash; '' → '/'.
 */
export const NORMALIZED_PATH = (col: Prisma.Sql) => Prisma.sql`
  COALESCE(NULLIF(regexp_replace(regexp_replace(split_part(split_part(${col}, '?', 1), '#', 1),
    '^/(uz|ru)(?=/|$)', ''), '(.)/+$', '\\1'), ''), '/')`;

/**
 * Rebuilds the A3 aggregates (`HeatmapCell`, `HeatmapElement`, `HeatmapPage`) for whole
 * Tashkent days from `Event`: delete + insert per day in one transaction, so a run is idempotent
 * and readers never see a half-built day (CLAUDE.md §6).
 */
@Injectable()
export class HeatmapAggregatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async aggregate(days: number, now = new Date()): Promise<{ days: number }> {
    for (const d of lastDays(days, now)) await this.aggregateDay(d.day, d.start, d.end, now);
    await this.redis.set(AGGREGATED_AT_KEY, now.toISOString());
    return { days };
  }

  async isEmpty(): Promise<boolean> {
    return (await this.prisma.heatmapPage.findFirst({ select: { day: true } })) === null;
  }

  async aggregatedAt(): Promise<string | null> {
    return this.redis.get(AGGREGATED_AT_KEY);
  }

  private async aggregateDay(day: string, start: Date, end: Date, now: Date): Promise<void> {
    const dayCol = dateColumn(day);
    const exitCutoff = new Date(now.getTime() - SESSION_IDLE_MS);
    await this.prisma.$transaction(
      async (tx) => {
        // One rebuild of a day at a time (hourly job, A3 button, boot backfill, API replicas).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`heatmaps:${day}`}))`;
        await tx.heatmapCell.deleteMany({ where: { day: dayCol } });
        await tx.heatmapElement.deleteMany({ where: { day: dayCol } });
        await tx.heatmapPage.deleteMany({ where: { day: dayCol } });

        // One pass over the day's events (+ a lookahead for "was this the last click?").
        // Device is decided once per session: the first viewport width seen, else the UA class.
        await tx.$executeRaw`
          CREATE TEMP TABLE hm_ev ON COMMIT DROP AS
          WITH raw AS (
            SELECT e.id, e."sessionId", e.name, e.ts, e.selector, e.x, e.y, e."viewportW",
                   e."scrollDepth", e.props, ${NORMALIZED_PATH(Prisma.sql`e.path`)} AS path
            FROM "Event" e
            WHERE e.ts >= ${start} AND e.ts < ${end}::timestamptz + ${LOOKAHEAD}
              AND e.name IN ('page_view','click','rage_click','dead_click','scroll_depth','web_vitals')
          ),
          sd AS (
            SELECT r."sessionId",
                   (array_agg(r."viewportW" ORDER BY r.ts) FILTER (WHERE r."viewportW" > 0))[1] AS vw,
                   max(s.device) AS ua
            FROM raw r LEFT JOIN "Session" s ON s.id = r."sessionId"
            GROUP BY r."sessionId"
          )
          SELECT r.*,
                 CASE WHEN sd.vw IS NOT NULL THEN CASE WHEN sd.vw < 768 THEN 'mobile' ELSE 'desktop' END
                      WHEN sd.ua = 'mobile' THEN 'mobile' ELSE 'desktop' END AS device,
                 CASE WHEN r.name IN ('page_view','click') THEN
                   LEAD(r.ts) OVER (PARTITION BY r."sessionId", r.name IN ('page_view','click')
                                    ORDER BY r.ts, r.id)
                 END AS next_ts
          FROM raw r JOIN sd ON sd."sessionId" = r."sessionId"`;
        await tx.$executeRaw`DELETE FROM hm_ev WHERE ts >= ${end}`;

        await tx.$executeRaw`
          INSERT INTO "HeatmapCell" (day, path, device, kind, x, y, count)
          SELECT ${dayCol}::date, path, device,
                 CASE name WHEN 'click' THEN 'click' WHEN 'rage_click' THEN 'rage' ELSE 'dead' END,
                 (LEAST(GREATEST(x, 0), 999) / ${HEATMAP_X_STEP}::int) * ${HEATMAP_X_STEP}::int,
                 (GREATEST(y, 0) / ${HEATMAP_Y_STEP}::int) * ${HEATMAP_Y_STEP}::int,
                 count(*)::int
          FROM hm_ev
          WHERE name IN ('click','rage_click','dead_click') AND x IS NOT NULL AND y IS NOT NULL
          GROUP BY 2, 3, 4, 5, 6`;

        await tx.$executeRaw`
          INSERT INTO "HeatmapElement" (day, path, device, selector, label, clicks, rage, dead, exits)
          SELECT ${dayCol}::date, path, device, selector,
                 max(left(props->>'track', 60)),
                 count(*) FILTER (WHERE name = 'click')::int,
                 count(*) FILTER (WHERE name = 'rage_click')::int,
                 count(*) FILTER (WHERE name = 'dead_click')::int,
                 count(*) FILTER (WHERE name = 'click' AND next_ts IS NULL AND ts < ${exitCutoff})::int
          FROM hm_ev
          WHERE name IN ('click','rage_click','dead_click') AND selector IS NOT NULL AND selector <> ''
          GROUP BY 2, 3, 4`;

        await tx.$executeRaw`
          INSERT INTO "HeatmapPage" (day, path, device, sessions, pageviews, reach25, reach50,
            reach75, reach100, "scrollSum", clicks, rage, dead, "lcpCount", "lcpSlow", "lcpSumMs")
          SELECT ${dayCol}::date, path, device,
                 count(*) FILTER (WHERE viewed)::int,
                 sum(pv)::int,
                 count(*) FILTER (WHERE viewed AND depth >= 25)::int,
                 count(*) FILTER (WHERE viewed AND depth >= 50)::int,
                 count(*) FILTER (WHERE viewed AND depth >= 75)::int,
                 count(*) FILTER (WHERE viewed AND depth >= 100)::int,
                 COALESCE(sum(depth) FILTER (WHERE viewed), 0)::int,
                 sum(clicks)::int, sum(rage)::int, sum(dead)::int,
                 sum(lcp_n)::int, sum(lcp_slow)::int, round(sum(lcp_sum))::bigint
          FROM (
            SELECT path, device, "sessionId",
                   bool_or(name = 'page_view') AS viewed,
                   count(*) FILTER (WHERE name = 'page_view') AS pv,
                   COALESCE(max("scrollDepth") FILTER (WHERE name = 'scroll_depth'), 0) AS depth,
                   count(*) FILTER (WHERE name = 'click') AS clicks,
                   count(*) FILTER (WHERE name = 'rage_click') AS rage,
                   count(*) FILTER (WHERE name = 'dead_click') AS dead,
                   count(*) FILTER (WHERE name = 'web_vitals' AND props->>'metric' = 'LCP') AS lcp_n,
                   count(*) FILTER (WHERE name = 'web_vitals' AND props->>'metric' = 'LCP'
                                    AND (props->>'value')::float8 > ${HEATMAP_INSIGHT_RULES.slowLcp.thresholdMs})
                     AS lcp_slow,
                   COALESCE(sum((props->>'value')::float8)
                     FILTER (WHERE name = 'web_vitals' AND props->>'metric' = 'LCP'), 0) AS lcp_sum
            FROM hm_ev
            GROUP BY 1, 2, 3
          ) sp
          GROUP BY 2, 3
          HAVING bool_or(viewed) OR sum(clicks) > 0`;
      },
      { timeout: 120_000 },
    );
  }
}
