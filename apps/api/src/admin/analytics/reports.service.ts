import {
  type AdPlatform,
  adPlatformOfSource,
  type AnalyticsPeriod,
  analyticsPeriod,
  type AnalyticsQuery,
  type AttributionModel,
  type ChannelRowDto,
  COHORT_MONTHS,
  COHORT_OFFSETS,
  type CohortsDto,
  type DevicesDto,
  type EventsDto,
  FUNNEL_STEPS,
  type FunnelDto,
  type FunnelStepDto,
  goalInsight,
  type PagesDto,
  type PeriodDto,
  ratio,
  type SourceRowDto,
  type SourcesDto,
  type SourceTotalsDto,
  TECHNICAL_EVENTS,
  tashkentDayKey,
  toTashkentParts,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { distributeSpend } from './ad-spend-match';
import {
  isPurchase,
  num,
  platformOf,
  purchaseSessionFilter,
  revenueOf,
  type SessionFilters,
  sessionCampaign,
  sessionFilter,
  sessionMedium,
  sessionSource,
  soum,
  tashkentDay,
} from './sql';

/** [from, to) instants of a period plus its day keys (for DATE columns). */
export interface Range {
  from: Date;
  to: Date;
  firstDay: string;
  lastDay: string;
}

export function currentRange(p: AnalyticsPeriod): Range {
  return { from: p.from, to: p.to, firstDay: p.firstDay, lastDay: p.lastDay };
}

export function previousRange(p: AnalyticsPeriod): Range {
  return {
    from: p.prevFrom,
    to: p.prevTo,
    firstDay: tashkentDayKey(p.prevFrom),
    lastDay: tashkentDayKey(new Date(p.prevTo.getTime() - 1)),
  };
}

export function periodDto(p: AnalyticsPeriod): PeriodDto {
  const prev = previousRange(p);
  return {
    days: p.days,
    firstDay: p.firstDay,
    lastDay: p.lastDay,
    previousFirstDay: prev.firstDay,
    previousLastDay: prev.lastDay,
  };
}

export interface CoreTotals {
  sessions: number;
  visitors: number;
  orders: number;
  revenueTiyin: number;
  leads: number;
}

type StepCounts = { g: string; visit: bigint; vi: bigint; atc: bigint; bc: bigint; pur: bigint };

function steps(r: StepCounts | undefined): FunnelStepDto[] {
  const v = r ? [r.visit, r.vi, r.atc, r.bc, r.pur] : [0n, 0n, 0n, 0n, 0n];
  return FUNNEL_STEPS.map((step, i) => ({ step, sessions: num(v[i]) }));
}

const rowKey = (source: string, medium: string, campaign: string | null) =>
  `${source}\u0001${medium}\u0001${campaign ?? ''}`;

/**
 * A2 reports and the A1 analytics blocks: SQL over Session / Event / Order / Payment (CLAUDE.md
 * §6 definitions). Every Event query is bounded by `ts` (partition pruning).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  period(q: { days: number; end?: string }, now = new Date()): AnalyticsPeriod {
    return analyticsPeriod(q.days, q.end, now);
  }

  /** Sessions in the range (filtered) — the base set of every session report. */
  private sessionsCte(r: Range, f: SessionFilters): Prisma.Sql {
    return Prisma.sql`SELECT s.* FROM "Session" s
      WHERE s."startedAt" >= ${r.from} AND s."startedAt" < ${r.to} ${sessionFilter(f, 's')}`;
  }

  /** Purchases placed in the range (filtered by their own session when filters are set). */
  private purchasesCte(r: Range, f: SessionFilters): Prisma.Sql {
    return Prisma.sql`SELECT o.id, o."createdAt", o."sessionId", o."customerId", o.attribution,
        ${revenueOf('o')} AS revenue
      FROM "Order" o
      WHERE o."createdAt" >= ${r.from} AND o."createdAt" < ${r.to} AND ${isPurchase('o')}
      ${purchaseSessionFilter(f, 'o')}`;
  }

  async totals(r: Range, f: SessionFilters = {}): Promise<CoreTotals> {
    const [row] = await this.prisma.$queryRaw<
      { sessions: bigint; visitors: bigint; orders: bigint; revenue: unknown; leads: bigint }[]
    >`
      WITH ss AS (${this.sessionsCte(r, f)}), pu AS (${this.purchasesCte(r, f)})
      SELECT (SELECT count(*) FROM ss) AS sessions,
             (SELECT count(DISTINCT "anonymousId") FROM ss) AS visitors,
             (SELECT count(*) FROM pu) AS orders,
             (SELECT COALESCE(SUM(revenue), 0) FROM pu) AS revenue,
             (SELECT count(*) FROM "Customer" c
               WHERE c."leadAt" >= ${r.from} AND c."leadAt" < ${r.to}) AS leads`;
    return {
      sessions: num(row?.sessions),
      visitors: num(row?.visitors),
      orders: num(row?.orders),
      revenueTiyin: num(row?.revenue),
      leads: num(row?.leads),
    };
  }

  /** Sessions, purchases and revenue per Tashkent day (every day present, zeros included). */
  async daily(p: AnalyticsPeriod, f: SessionFilters = {}) {
    const r = currentRange(p);
    const [sessions, orders] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; n: bigint }[]>`
        SELECT to_char(${tashkentDay(Prisma.sql`ss."startedAt"`)}, 'YYYY-MM-DD') AS day, count(*) AS n
        FROM (${this.sessionsCte(r, f)}) ss GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; n: bigint; revenue: unknown }[]>`
        SELECT to_char(${tashkentDay(Prisma.sql`pu."createdAt"`)}, 'YYYY-MM-DD') AS day,
               count(*) AS n, SUM(pu.revenue) AS revenue
        FROM (${this.purchasesCte(r, f)}) pu GROUP BY 1`,
    ]);
    const s = new Map(sessions.map((x) => [x.day, num(x.n)]));
    const o = new Map(orders.map((x) => [x.day, x]));
    return p.dayKeys.map((day) => ({
      day,
      sessions: s.get(day) ?? 0,
      orders: num(o.get(day)?.n),
      revenueSoum: soum(o.get(day)?.revenue),
    }));
  }

  /** Open funnel: sessions in the range that did each step; grouped by device/channel or not. */
  private async funnelRows(r: Range, f: SessionFilters, group: 'all' | 'device' | 'channel') {
    const g = Prisma.raw(group === 'all' ? `'all'` : `ss.${group}`);
    return this.prisma.$queryRaw<StepCounts[]>`
      WITH ss AS (${this.sessionsCte(r, f)}),
      ev AS (
        SELECT e."sessionId",
               bool_or(e.name = 'view_item') AS vi,
               bool_or(e.name = 'add_to_cart') AS atc,
               bool_or(e.name = 'begin_checkout') AS bc
        FROM "Event" e
        WHERE e.ts >= ${r.from} AND e.ts < ${r.to}
          AND e.name IN ('view_item', 'add_to_cart', 'begin_checkout')
          AND e."sessionId" IN (SELECT id FROM ss)
        GROUP BY e."sessionId"),
      pu AS (
        SELECT DISTINCT o."sessionId" FROM "Order" o
        WHERE o."sessionId" IN (SELECT id FROM ss) AND ${isPurchase('o')})
      SELECT ${g}::text AS g, count(*) AS visit,
             count(*) FILTER (WHERE ev.vi) AS vi,
             count(*) FILTER (WHERE ev.atc) AS atc,
             count(*) FILTER (WHERE ev.bc) AS bc,
             count(pu."sessionId") AS pur
      FROM ss LEFT JOIN ev ON ev."sessionId" = ss.id LEFT JOIN pu ON pu."sessionId" = ss.id
      GROUP BY 1 ORDER BY count(*) DESC`;
  }

  async funnelSteps(r: Range, f: SessionFilters = {}): Promise<FunnelStepDto[]> {
    const [row] = await this.funnelRows(r, f, 'all');
    return steps(row);
  }

  async funnel(q: AnalyticsQuery, now = new Date()): Promise<FunnelDto> {
    const p = this.period(q, now);
    const r = currentRange(p);
    const f = { device: q.device, channel: q.channel };
    const [all, prev, byDevice, byChannel] = await Promise.all([
      this.funnelRows(r, f, 'all'),
      q.compare ? this.funnelRows(previousRange(p), f, 'all') : Promise.resolve(null),
      this.funnelRows(r, f, 'device'),
      this.funnelRows(r, f, 'channel'),
    ]);
    return {
      period: periodDto(p),
      steps: steps(all[0]),
      previous: prev ? steps(prev[0]) : null,
      byDevice: byDevice.map((x) => ({ device: x.g, steps: steps(x) })),
      byChannel: byChannel.slice(0, 12).map((x) => ({ channel: x.g, steps: steps(x) })),
    };
  }

  /** Model-attributed purchases and revenue per touch key (source/medium/campaign/channel). */
  private attributed(r: Range, f: SessionFilters, model: AttributionModel) {
    return this.prisma.$queryRaw<
      {
        source: string;
        medium: string;
        campaign: string | null;
        channel: string;
        orders: unknown;
        revenue: unknown;
      }[]
    >`
      SELECT t->>'source' AS source, t->>'medium' AS medium, t->>'campaign' AS campaign,
             t->>'channel' AS channel,
             SUM((t->'shares'->>${model}::text)::numeric) AS orders,
             SUM(pu.revenue * (t->'shares'->>${model}::text)::numeric) AS revenue
      FROM (${this.purchasesCte(r, f)}) pu
      CROSS JOIN LATERAL jsonb_array_elements(pu.attribution->'touches') t
      WHERE pu.attribution IS NOT NULL
      GROUP BY 1, 2, 3, 4`;
  }

  /** Purchases in the range not attributed yet (job lag) — shown, never silently dropped. */
  private async pending(r: Range, f: SessionFilters) {
    const [row] = await this.prisma.$queryRaw<{ n: bigint; revenue: unknown }[]>`
      SELECT count(*) AS n, COALESCE(SUM(pu.revenue), 0) AS revenue
      FROM (${this.purchasesCte(r, f)}) pu WHERE pu.attribution IS NULL`;
    return { orders: num(row?.n), revenueTiyin: num(row?.revenue) };
  }

  /** Traffic per channel + model-attributed purchases/revenue per touch channel. */
  async channels(r: Range, f: SessionFilters, model: AttributionModel): Promise<ChannelRowDto[]> {
    const [sessions, attributed] = await Promise.all([
      this.prisma.$queryRaw<{ channel: string; sessions: bigint; purchasing: bigint }[]>`
        WITH ss AS (${this.sessionsCte(r, f)})
        SELECT ss.channel, count(*) AS sessions,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Order" po
                 WHERE po."sessionId" = ss.id AND ${isPurchase('po')})) AS purchasing
        FROM ss GROUP BY 1`,
      this.attributed(r, f, model),
    ]);
    const rows = new Map<string, ChannelRowDto>();
    const get = (channel: string) => {
      let row = rows.get(channel);
      if (!row) {
        row = { channel, sessions: 0, purchasingSessions: 0, orders: 0, revenueSoum: 0 };
        rows.set(channel, row);
      }
      return row;
    };
    for (const s of sessions) {
      const row = get(s.channel);
      row.sessions = num(s.sessions);
      row.purchasingSessions = num(s.purchasing);
    }
    const revenue = new Map<string, number>();
    for (const a of attributed) {
      get(a.channel).orders += num(a.orders);
      revenue.set(a.channel, (revenue.get(a.channel) ?? 0) + num(a.revenue));
    }
    for (const [channel, tiyin] of revenue) get(channel).revenueSoum = soum(tiyin);
    return [...rows.values()]
      .map((x) => ({ ...x, orders: Math.round(x.orders * 100) / 100 }))
      .sort((a, b) => b.sessions - a.sessions || b.revenueSoum - a.revenueSoum);
  }

  private async spendTotal(r: Range): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ spend: unknown }[]>`
      SELECT COALESCE(SUM("spendTiyin"), 0) AS spend FROM "AdSpendDaily"
      WHERE date >= ${r.firstDay}::date AND date <= ${r.lastDay}::date`;
    return num(row?.spend);
  }

  private async sourceTotals(r: Range, f: SessionFilters): Promise<SourceTotalsDto> {
    const [t, spend, leads] = await Promise.all([
      this.totals(r, f),
      f.device ? Promise.resolve(0) : this.spendTotal(r),
      this.leadSessions(r, f),
    ]);
    const revenueSoum = soum(t.revenueTiyin);
    const spendSoum = soum(spend);
    return {
      sessions: t.sessions,
      leads,
      orders: t.orders,
      revenueSoum,
      spendSoum,
      roas: spendSoum > 0 ? revenueSoum / spendSoum : null,
    };
  }

  /** Sessions in the range with a `lead` event (A2 "Lead" column). */
  private async leadSessions(r: Range, f: SessionFilters): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      WITH ss AS (${this.sessionsCte(r, f)})
      SELECT count(DISTINCT e."sessionId") AS n FROM "Event" e
      WHERE e.ts >= ${r.from} AND e.ts < ${r.to} AND e.name = 'lead'
        AND e."sessionId" IN (SELECT id FROM ss)`;
    return num(row?.n);
  }

  async sources(q: AnalyticsQuery, now = new Date()): Promise<SourcesDto> {
    const p = this.period(q, now);
    const r = currentRange(p);
    const f = { device: q.device, channel: q.channel };
    const src = sessionSource('ss');
    const [traffic, attributed, spends, totals, previousTotals, pending, channels] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            source: string;
            medium: string;
            campaign: string | null;
            channel: string;
            platform: AdPlatform | null;
            sessions: bigint;
            bounces: bigint;
            avgdur: unknown;
            leads: bigint;
          }[]
        >`
          WITH ss AS (${this.sessionsCte(r, f)}),
          ld AS (
            SELECT DISTINCT e."sessionId" FROM "Event" e
            WHERE e.ts >= ${r.from} AND e.ts < ${r.to} AND e.name = 'lead'
              AND e."sessionId" IN (SELECT id FROM ss)),
          sk AS (
            SELECT ss.id, ss.channel, ss.bounced, ss."durationSec",
                   ${src} AS source, ${sessionMedium('ss')} AS medium,
                   ${sessionCampaign('ss')} AS campaign
            FROM ss)
          SELECT sk.source, sk.medium, sk.campaign, min(sk.channel) AS channel,
                 ${platformOf(Prisma.sql`sk.source`)} AS platform,
                 count(*) AS sessions, count(*) FILTER (WHERE sk.bounced) AS bounces,
                 avg(sk."durationSec") AS avgdur, count(ld."sessionId") AS leads
          FROM sk LEFT JOIN ld ON ld."sessionId" = sk.id
          GROUP BY sk.source, sk.medium, sk.campaign
          ORDER BY count(*) DESC LIMIT 200`,
        this.attributed(r, f, q.model),
        this.prisma.$queryRaw<
          { platform: string; campaignId: string; campaign: string; spend: unknown }[]
        >`
          SELECT platform, "campaignId", max(campaign) AS campaign, SUM("spendTiyin") AS spend
          FROM "AdSpendDaily"
          WHERE date >= ${r.firstDay}::date AND date <= ${r.lastDay}::date
          GROUP BY platform, "campaignId"`,
        this.sourceTotals(r, f),
        q.compare ? this.sourceTotals(previousRange(p), f) : Promise.resolve(null),
        this.pending(r, f),
        this.channels(r, f, q.model),
      ]);

    const rows = new Map<string, SourceRowDto & { revenueTiyin: number }>();
    for (const t of traffic) {
      const sessions = num(t.sessions);
      rows.set(rowKey(t.source, t.medium, t.campaign), {
        source: t.source,
        medium: t.medium,
        campaign: t.campaign,
        channel: t.channel,
        platform: t.platform,
        sessions,
        bounceRate: ratio(num(t.bounces), sessions),
        avgDurationSec: sessions ? Math.round(num(t.avgdur)) : null,
        leads: num(t.leads),
        orders: 0,
        revenueSoum: 0,
        revenueTiyin: 0,
        spendSoum: null,
        roas: null,
      });
    }
    for (const a of attributed) {
      const key = rowKey(a.source, a.medium, a.campaign);
      let row = rows.get(key);
      if (!row) {
        row = {
          source: a.source,
          medium: a.medium,
          campaign: a.campaign,
          channel: a.channel,
          platform: null,
          sessions: 0,
          bounceRate: null,
          avgDurationSec: null,
          leads: 0,
          orders: 0,
          revenueSoum: 0,
          revenueTiyin: 0,
          spendSoum: null,
          roas: null,
        };
        rows.set(key, row);
      }
      row.orders += num(a.orders);
      row.revenueTiyin += num(a.revenue);
    }
    if (pending.orders > 0) {
      rows.set('\u0002pending', {
        source: '(hisoblanmoqda)',
        medium: '—',
        campaign: null,
        channel: '(pending)',
        platform: null,
        sessions: 0,
        bounceRate: null,
        avgDurationSec: null,
        leads: 0,
        orders: pending.orders,
        revenueSoum: 0,
        revenueTiyin: pending.revenueTiyin,
        spendSoum: null,
        roas: null,
      });
    }
    // Rows without a platform (organic, telegram…) can still be ad rows by utm source.
    for (const row of rows.values()) row.platform ??= adPlatformOfSource(row.source);

    // Spend (not per device: imported spend has no device split).
    if (!q.device) {
      const { byRow, unmatched } = distributeSpend(
        [...rows.entries()].map(([key, x]) => ({
          key,
          platform: x.platform,
          campaign: x.campaign,
          sessions: x.sessions,
        })),
        spends.map((s) => ({
          platform: s.platform,
          campaignId: s.campaignId,
          campaign: s.campaign,
          spendTiyin: BigInt(String(s.spend)),
        })),
      );
      for (const [key, tiyin] of byRow) rows.get(key)!.spendSoum = soum(tiyin);
      if (!q.channel)
        for (const s of unmatched)
          rows.set(`\u0003${s.platform}:${s.campaignId}`, {
            source: s.platform,
            medium: 'cpc',
            campaign: s.campaign,
            channel: `paid_${s.platform}`,
            platform: s.platform as AdPlatform,
            sessions: 0,
            bounceRate: null,
            avgDurationSec: null,
            leads: 0,
            orders: 0,
            revenueSoum: 0,
            revenueTiyin: 0,
            spendSoum: soum(s.spendTiyin),
            roas: null,
          });
    }
    const out = [...rows.values()].map(({ revenueTiyin, ...x }) => {
      const revenueSoum = soum(revenueTiyin);
      return {
        ...x,
        orders: Math.round(x.orders * 100) / 100,
        revenueSoum,
        roas: x.spendSoum ? revenueSoum / x.spendSoum : null,
      };
    });
    out.sort(
      (a, b) =>
        b.sessions - a.sessions ||
        b.revenueSoum - a.revenueSoum ||
        (b.spendSoum ?? 0) - (a.spendSoum ?? 0),
    );
    return {
      period: periodDto(p),
      model: q.model,
      rows: out,
      channels,
      totals,
      previousTotals,
      pendingOrders: pending.orders,
    };
  }

  async pages(q: AnalyticsQuery, now = new Date()): Promise<PagesDto> {
    const p = this.period(q, now);
    const r = currentRange(p);
    const f = { device: q.device, channel: q.channel };
    const [landing, exit] = await Promise.all([
      this.prisma.$queryRaw<{ path: string; sessions: bigint; bounces: bigint }[]>`
        SELECT ss."landingPath" AS path, count(*) AS sessions,
               count(*) FILTER (WHERE ss.bounced) AS bounces
        FROM (${this.sessionsCte(r, f)}) ss
        GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 20`,
      this.prisma.$queryRaw<{ path: string; exits: bigint; pageviews: bigint }[]>`
        WITH ss AS (${this.sessionsCte(r, f)}),
        ex AS (
          SELECT ss."exitPath" AS path, count(*) AS exits FROM ss
          WHERE ss."exitPath" IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 20),
        pv AS (
          SELECT e.path, count(*) AS pageviews FROM "Event" e
          WHERE e.ts >= ${r.from} AND e.ts < ${r.to} AND e.name = 'page_view'
            AND e.path IN (SELECT path FROM ex) AND e."sessionId" IN (SELECT id FROM ss)
          GROUP BY 1)
        SELECT ex.path, ex.exits, COALESCE(pv.pageviews, 0) AS pageviews
        FROM ex LEFT JOIN pv ON pv.path = ex.path ORDER BY ex.exits DESC, ex.path`,
    ]);
    return {
      period: periodDto(p),
      landing: landing.map((x) => ({
        path: x.path,
        sessions: num(x.sessions),
        bounceRate: ratio(num(x.bounces), num(x.sessions)),
      })),
      exit: exit.map((x) => {
        const pageviews = num(x.pageviews);
        const exits = num(x.exits);
        return {
          path: x.path,
          exits,
          pageviews,
          exitRate: pageviews ? Math.min(1, exits / pageviews) : null,
        };
      }),
    };
  }

  async events(q: AnalyticsQuery, now = new Date()): Promise<EventsDto> {
    const p = this.period(q, now);
    const r = currentRange(p);
    const f = { device: q.device, channel: q.channel };
    const base = Prisma.sql`
      ss AS (${this.sessionsCte(r, f)}),
      pu AS (SELECT DISTINCT o."sessionId" AS id FROM "Order" o
             WHERE o."sessionId" IN (SELECT id FROM ss) AND ${isPurchase('o')})`;
    const [rows, [overall]] = await Promise.all([
      this.prisma.$queryRaw<{ name: string; cnt: bigint; sessions: bigint; purchasing: bigint }[]>`
        WITH ${base}
        SELECT e.name, count(*) AS cnt, count(DISTINCT e."sessionId") AS sessions,
               count(DISTINCT e."sessionId") FILTER (WHERE pu.id IS NOT NULL) AS purchasing
        FROM "Event" e JOIN ss ON ss.id = e."sessionId" LEFT JOIN pu ON pu.id = e."sessionId"
        WHERE e.ts >= ${r.from} AND e.ts < ${r.to}
          AND e.name NOT IN (${Prisma.join(TECHNICAL_EVENTS)})
        GROUP BY e.name ORDER BY count(DISTINCT e."sessionId") DESC, e.name LIMIT 30`,
      this.prisma.$queryRaw<{ sessions: bigint; purchasing: bigint }[]>`
        WITH ${base}
        SELECT (SELECT count(*) FROM ss) AS sessions, (SELECT count(*) FROM pu) AS purchasing`,
    ]);
    const sessions = num(overall?.sessions);
    const purchasingSessions = num(overall?.purchasing);
    const rate = ratio(purchasingSessions, sessions);
    const events = rows.map((x) => {
      const s = num(x.sessions);
      const pur = num(x.purchasing);
      const er = ratio(pur, s);
      return {
        name: x.name,
        count: num(x.cnt),
        sessions: s,
        purchasingSessions: pur,
        rate: er,
        lift: er !== null && rate ? er / rate : null,
      };
    });
    return {
      period: periodDto(p),
      overall: { sessions, purchasingSessions, rate },
      events,
      insight: goalInsight(events, { sessions, purchasingSessions }),
    };
  }

  async devices(q: AnalyticsQuery, now = new Date()): Promise<DevicesDto> {
    const p = this.period(q, now);
    const r = currentRange(p);
    const f = { device: q.device, channel: q.channel };
    const purchased = Prisma.sql`EXISTS (SELECT 1 FROM "Order" po
      WHERE po."sessionId" = ss.id AND ${isPurchase('po')})`;
    const [devices, regions] = await Promise.all([
      this.prisma.$queryRaw<{ device: string; sessions: bigint; purchasing: bigint }[]>`
        SELECT ss.device, count(*) AS sessions, count(*) FILTER (WHERE ${purchased}) AS purchasing
        FROM (${this.sessionsCte(r, f)}) ss GROUP BY 1 ORDER BY count(*) DESC`,
      this.prisma.$queryRaw<{ region: string; sessions: bigint; purchasing: bigint }[]>`
        SELECT COALESCE(NULLIF(ss.region, ''), '—') AS region, count(*) AS sessions,
               count(*) FILTER (WHERE ${purchased}) AS purchasing
        FROM (${this.sessionsCte(r, f)}) ss GROUP BY 1 ORDER BY count(*) DESC, 1`,
    ]);
    const total = devices.reduce((a, d) => a + num(d.sessions), 0);
    const top = regions.slice(0, 11);
    const rest = regions.slice(11);
    return {
      period: periodDto(p),
      devices: devices.map((d) => ({
        device: d.device,
        sessions: num(d.sessions),
        share: ratio(num(d.sessions), total),
        purchasingSessions: num(d.purchasing),
        conversionRate: ratio(num(d.purchasing), num(d.sessions)),
      })),
      regions: [
        ...top.map((x) => ({
          region: x.region,
          sessions: num(x.sessions),
          purchasingSessions: num(x.purchasing),
        })),
        ...(rest.length
          ? [
              {
                region: '(boshqa)',
                sessions: rest.reduce((a, x) => a + num(x.sessions), 0),
                purchasingSessions: rest.reduce((a, x) => a + num(x.purchasing), 0),
              },
            ]
          : []),
      ],
    };
  }

  /** Repeat purchase by first-purchase month (Tashkent), last `COHORT_MONTHS` cohorts. */
  async cohorts(now = new Date()): Promise<CohortsDto> {
    const nowParts = toTashkentParts(now);
    const monthIndex = (y: number, m: number) => y * 12 + (m - 1);
    const current = monthIndex(nowParts.year, nowParts.month);
    const first = current - (COHORT_MONTHS - 1);
    const since = `${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, '0')}-01`;
    const rows = await this.prisma.$queryRaw<{ month: string; k: number; n: bigint }[]>`
      WITH p AS (
        SELECT o."customerId" AS cid,
               date_trunc('month', o."createdAt" AT TIME ZONE 'Asia/Tashkent')::date AS m
        FROM "Order" o WHERE ${isPurchase('o')}),
      f AS (SELECT cid, min(m) AS first FROM p GROUP BY cid),
      j AS (
        SELECT f.first, f.cid,
               ((EXTRACT(YEAR FROM p.m)::int - EXTRACT(YEAR FROM f.first)::int) * 12
                + EXTRACT(MONTH FROM p.m)::int - EXTRACT(MONTH FROM f.first)::int) AS k
        FROM f JOIN p ON p.cid = f.cid
        WHERE f.first >= ${since}::date)
      SELECT to_char(first, 'YYYY-MM') AS month, k, count(DISTINCT cid) AS n
      FROM j WHERE k BETWEEN 0 AND ${COHORT_OFFSETS} GROUP BY 1, 2`;
    const cohorts: CohortsDto['cohorts'] = [];
    for (let m = first; m <= current; m++) {
      const key = `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
      const size = num(rows.find((x) => x.month === key && x.k === 0)?.n);
      if (!size) continue;
      cohorts.push({
        month: key,
        customers: size,
        retention: Array.from({ length: COHORT_OFFSETS }, (_, i) => {
          const k = i + 1;
          if (m + k > current) return null;
          return num(rows.find((x) => x.month === key && x.k === k)?.n) / size;
        }),
      });
    }
    return { cohorts };
  }
}
