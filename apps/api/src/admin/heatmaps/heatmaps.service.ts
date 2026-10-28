import { Injectable } from '@nestjs/common';
import {
  avgScrollPct,
  type HeatmapCellDto,
  type HeatmapDevice,
  type HeatmapDto,
  type HeatmapElementStat,
  heatmapInsights,
  type HeatmapPageAgg,
  type HeatmapPagesDto,
  type HeatmapPagesQuery,
  type HeatmapQuery,
  SCROLL_DEPTHS,
} from '@forest/contracts';
import { HeatmapAggregatorService } from '../../heatmaps/heatmap-aggregator.service';
import { dateColumn, lastDays } from '../../heatmaps/heatmap-days';
import { PrismaService } from '../../prisma/prisma.service';

const TOP_PAGES = 30;
const TOP_ELEMENTS = 10;
/** Elements considered by the problem rules (dead/rage hotspots may not be the most clicked). */
const RULE_ELEMENTS = 200;

/** A3 reads: only the per-day aggregates (`HeatmapPage/Cell/Element`), never raw events. */
@Injectable()
export class AdminHeatmapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregator: HeatmapAggregatorService,
  ) {}

  private range(days: number, now: Date) {
    const all = lastDays(days, now);
    const from = all[0]!.day;
    const to = all[all.length - 1]!.day;
    return { from, to, where: { gte: dateColumn(from), lte: dateColumn(to) } };
  }

  async pages(q: HeatmapPagesQuery, now = new Date()): Promise<HeatmapPagesDto> {
    const { where } = this.range(q.days, now);
    const rows = await this.prisma.heatmapPage.groupBy({
      by: ['path'],
      where: { day: where, device: q.device },
      _sum: { sessions: true },
      orderBy: { _sum: { sessions: 'desc' } },
      take: TOP_PAGES,
    });
    return {
      device: q.device,
      days: q.days,
      pages: rows
        .map((r) => ({ path: r.path, sessions: r._sum.sessions ?? 0 }))
        .filter((r) => r.sessions > 0),
    };
  }

  private async pageAgg(
    path: string,
    device: HeatmapDevice,
    day: { gte: Date; lte: Date },
  ): Promise<HeatmapPageAgg | null> {
    const a = await this.prisma.heatmapPage.aggregate({
      where: { path, device, day },
      _count: { _all: true },
      _sum: {
        sessions: true,
        pageviews: true,
        reach25: true,
        reach50: true,
        reach75: true,
        reach100: true,
        scrollSum: true,
        clicks: true,
        rage: true,
        dead: true,
        lcpCount: true,
        lcpSlow: true,
        lcpSumMs: true,
      },
    });
    if (a._count._all === 0) return null;
    const s = a._sum;
    return {
      sessions: s.sessions ?? 0,
      pageviews: s.pageviews ?? 0,
      reach: { 25: s.reach25 ?? 0, 50: s.reach50 ?? 0, 75: s.reach75 ?? 0, 100: s.reach100 ?? 0 },
      scrollSum: s.scrollSum ?? 0,
      clicks: s.clicks ?? 0,
      rage: s.rage ?? 0,
      dead: s.dead ?? 0,
      lcpCount: s.lcpCount ?? 0,
      lcpSlow: s.lcpSlow ?? 0,
      lcpSumMs: Number(s.lcpSumMs ?? 0n),
    };
  }

  private async cells(
    path: string,
    device: HeatmapDevice,
    kind: 'click' | 'rage',
    day: { gte: Date; lte: Date },
  ): Promise<HeatmapCellDto[]> {
    const rows = await this.prisma.heatmapCell.groupBy({
      by: ['x', 'y'],
      where: { path, device, kind, day },
      _sum: { count: true },
    });
    return rows.map((r) => ({ x: r.x, y: r.y, count: r._sum.count ?? 0 }));
  }

  private async elements(
    path: string,
    device: HeatmapDevice,
    day: { gte: Date; lte: Date },
  ): Promise<HeatmapElementStat[]> {
    const rows = await this.prisma.heatmapElement.groupBy({
      by: ['selector'],
      where: { path, device, day },
      _sum: { clicks: true, rage: true, dead: true, exits: true },
      _max: { label: true },
      orderBy: { _sum: { clicks: 'desc' } },
      take: RULE_ELEMENTS,
    });
    return rows.map((r) => ({
      selector: r.selector,
      label: r._max.label ?? null,
      clicks: r._sum.clicks ?? 0,
      rage: r._sum.rage ?? 0,
      dead: r._sum.dead ?? 0,
      exits: r._sum.exits ?? 0,
    }));
  }

  async heatmap(q: HeatmapQuery, now = new Date()): Promise<HeatmapDto> {
    const { from, to, where } = this.range(q.days, now);
    const [page, mobile, clicks, rage, elements, aggregatedAt] = await Promise.all([
      this.pageAgg(q.path, q.device, where),
      q.device === 'mobile' ? null : this.pageAgg(q.path, 'mobile', where),
      this.cells(q.path, q.device, 'click', where),
      this.cells(q.path, q.device, 'rage', where),
      this.elements(q.path, q.device, where),
      this.aggregator.aggregatedAt(),
    ]);
    const mobileAgg = q.device === 'mobile' ? page : mobile;
    return {
      path: q.path,
      device: q.device,
      days: q.days,
      from,
      to,
      kpis: {
        sessions: page?.sessions ?? 0,
        avgScrollPct: avgScrollPct(page),
        rageClicks: page?.rage ?? 0,
        deadClicks: page?.dead ?? 0,
      },
      clicks,
      rage,
      scroll: SCROLL_DEPTHS.map((depth) => ({
        depth,
        reachedPct:
          page && page.sessions > 0 ? Math.round((page.reach[depth] / page.sessions) * 100) : null,
      })),
      elements: elements.filter((e) => e.clicks > 0).slice(0, TOP_ELEMENTS),
      insights: heatmapInsights({ page, mobile: mobileAgg, elements }),
      aggregatedAt,
    };
  }
}
