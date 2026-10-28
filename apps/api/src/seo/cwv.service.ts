import { Injectable } from '@nestjs/common';
import {
  type AdminCwvDto,
  type CwvMetric,
  cwvRating,
  DomainError,
  type PageSpeedRunDto,
} from '@forest/contracts';
import { type PageSpeedRun, Prisma } from '@forest/db';
import { IntegrationsService } from '../integrations/integrations.service';
import { PageSpeedInsights } from '../integrations/providers/seo-tools';
import { PrismaService } from '../prisma/prisma.service';

const METRICS: CwvMetric[] = ['LCP', 'INP', 'CLS'];
const DAY_MS = 86_400_000;
/** A page needs this many samples of a metric before its p75 is shown. */
const MIN_PAGE_SAMPLES = 10;

type Row = { metric: string; path: string | null; p75: number | null; n: bigint };

/**
 * Core Web Vitals for A9 (CLAUDE.md §6): field p75 from the tracker's `web_vitals` events and
 * optional PageSpeed Insights lab runs.
 */
@Injectable()
export class CwvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  async field(days = 28, now = new Date()): Promise<Omit<AdminCwvDto, 'lab'>> {
    const since = new Date(now.getTime() - days * DAY_MS);
    const [mobile] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "Event" e JOIN "Session" s ON s."id" = e."sessionId"
      WHERE e."name" = 'web_vitals' AND e."ts" >= ${since} AND s."device" = 'mobile'`;
    const scope: AdminCwvDto['scope'] = Number(mobile?.n ?? 0) > 0 ? 'mobile' : 'all';
    const deviceFilter =
      scope === 'mobile'
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Session" s WHERE s."id" = e."sessionId" AND s."device" = 'mobile')`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT e."props"->>'metric' AS metric,
             CASE WHEN GROUPING(e."path") = 1 THEN NULL ELSE e."path" END AS path,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY (e."props"->>'value')::float8) AS p75,
             COUNT(*)::bigint AS n
      FROM "Event" e
      WHERE e."name" = 'web_vitals' AND e."ts" >= ${since}
        AND e."props"->>'metric' IN ('LCP', 'INP', 'CLS')
        AND jsonb_typeof(e."props"->'value') = 'number'
        ${deviceFilter}
      GROUP BY GROUPING SETS ((e."props"->>'metric'), (e."props"->>'metric', e."path"))`;

    const site = rows.filter((r) => r.path === null);
    const metrics = METRICS.map((metric) => {
      const r = site.find((x) => x.metric === metric);
      const p75 = r?.p75 === null || r?.p75 === undefined ? null : round(metric, Number(r.p75));
      return {
        metric,
        p75,
        rating: p75 === null ? null : cwvRating(metric, p75),
        samples: Number(r?.n ?? 0),
      };
    });
    const byPath = new Map<string, AdminCwvDto['pages'][number]>();
    for (const r of rows) {
      if (r.path === null || Number(r.n) < MIN_PAGE_SAMPLES || r.p75 === null) continue;
      const metric = r.metric as CwvMetric;
      const page = byPath.get(r.path) ?? {
        path: r.path,
        samples: 0,
        LCP: null,
        INP: null,
        CLS: null,
      };
      page[metric] = round(metric, Number(r.p75));
      page.samples = Math.max(page.samples, Number(r.n));
      byPath.set(r.path, page);
    }
    const badness = (p: AdminCwvDto['pages'][number]) =>
      METRICS.reduce((s, m) => {
        const v = p[m];
        const rating = v === null ? 'good' : cwvRating(m, v);
        return s + (rating === 'poor' ? 2 : rating === 'needs-improvement' ? 1 : 0);
      }, 0);
    const pages = [...byPath.values()]
      .sort((a, b) => badness(b) - badness(a) || (b.LCP ?? 0) - (a.LCP ?? 0))
      .slice(0, 20);
    return { scope, days, metrics, pages };
  }

  async lab(limit = 10): Promise<PageSpeedRunDto[]> {
    const rows = await this.prisma.pageSpeedRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(runDto);
  }

  /**
   * One PageSpeed Insights lab run (needs the `pagespeed` integration connected; fake mode makes
   * no external call and stores nothing).
   */
  async runLab(
    url: string,
    strategy: 'mobile' | 'desktop',
    staffId: string,
  ): Promise<PageSpeedRunDto | null> {
    if (this.integrations.fakeMode) return null;
    const creds = await this.integrations.connectedCredentials('pagespeed');
    const row = await this.prisma.integration.findUnique({ where: { key: 'pagespeed' } });
    if (!creds && row?.status !== 'CONNECTED') throw new DomainError('SEO_SOURCE_NOT_CONNECTED');
    const psi = new PageSpeedInsights(
      creds ?? {},
      this.integrations.httpClient('pagespeed', { maxRetries: 0 }),
    );
    const lab = await psi.run(url, strategy);
    return runDto(
      await this.prisma.pageSpeedRun.create({ data: { url, strategy, staffId, ...lab } }),
    );
  }
}

function runDto(r: PageSpeedRun): PageSpeedRunDto {
  return {
    id: r.id,
    url: r.url,
    strategy: r.strategy === 'desktop' ? 'desktop' : 'mobile',
    score: r.score,
    lcpMs: r.lcpMs,
    cls: r.cls,
    tbtMs: r.tbtMs,
    fcpMs: r.fcpMs,
    createdAt: r.createdAt.toISOString(),
  };
}

function round(metric: CwvMetric, v: number): number {
  return metric === 'CLS' ? Math.round(v * 1000) / 1000 : Math.round(v);
}
