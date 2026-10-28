import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminSearchQueriesDto,
  type AdminSearchTotalsDto,
  DomainError,
  type SeoSourceStateDto,
  toTashkentParts,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { IntegrationsService } from '../integrations/integrations.service';
import { searchQuerySource } from '../integrations/providers/seo-factory';
import {
  FakeSearchQuerySource,
  type SearchQuerySource,
  type SearchQueryStat,
} from '../integrations/providers/seo-search';
import { PrismaService } from '../prisma/prisma.service';

export type SearchSource = 'gsc' | 'ywm';
export const SEARCH_SOURCES: readonly SearchSource[] = ['gsc', 'ywm'];
/** Both providers finalise a day 2–3 days late: every sync re-reads this many past days. */
export const SYNC_LOOKBACK_DAYS = 5;
const SYNC_KIND = 'queries.sync';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Tashkent calendar day `YYYY-MM-DD`, `days` from `at`. */
export function tashkentDay(at: Date, days = 0): string {
  const p = toTashkentParts(new Date(at.getTime() + days * DAY_MS));
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Search Console / Yandex Webmaster query stats (A9): daily sync into `SearchQueryDaily` and the
 * report (totals vs the previous period, top queries). Credentials only from the CONNECTED
 * Integration rows; fakes return nothing (empty state).
 */
@Injectable()
export class SearchQueriesService {
  private readonly logger = new Logger('SearchQueries');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** null = not connected (and not fake mode). */
  async source(key: SearchSource): Promise<SearchQuerySource | null> {
    if (this.integrations.fakeMode) return new FakeSearchQuerySource(key);
    const creds = await this.integrations.connectedCredentials(key);
    return creds ? searchQuerySource(key, creds, this.integrations.httpClient(key)) : null;
  }

  async state(key: SearchSource): Promise<SeoSourceStateDto> {
    const [row, last] = await Promise.all([
      this.prisma.integration.findUnique({ where: { key }, select: { status: true } }),
      this.prisma.integrationLog.findFirst({
        where: { integrationKey: key, kind: SYNC_KIND, ok: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      status: (row?.status ?? 'DISCONNECTED') as SeoSourceStateDto['status'],
      lastSyncedAt: last?.createdAt.toISOString() ?? null,
    };
  }

  /** Daily job / A9 "sync now": re-reads the last `SYNC_LOOKBACK_DAYS` days of each source. */
  async sync(
    sources: readonly SearchSource[] = SEARCH_SOURCES,
    now = new Date(),
  ): Promise<{ source: SearchSource; rows: number; error: string | null }[]> {
    const from = tashkentDay(now, -SYNC_LOOKBACK_DAYS);
    const to = tashkentDay(now, -1);
    const out = [];
    for (const key of sources) {
      const source = await this.source(key);
      if (!source || source instanceof FakeSearchQuerySource) {
        out.push({ source: key, rows: 0, error: source ? null : 'not connected' });
        continue;
      }
      try {
        const rows = await source.queries(from, to);
        await this.ingest(key, from, to, rows);
        await this.integrations.log(key, {
          direction: 'OUT',
          kind: SYNC_KIND,
          ok: true,
          message: `${rows.length} row(s) for ${from}…${to}`,
        });
        out.push({ source: key, rows: rows.length, error: null });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(`${key} sync failed: ${message}`);
        await this.integrations
          .log(key, { direction: 'OUT', kind: SYNC_KIND, ok: false, message })
          .catch(() => undefined);
        out.push({ source: key, rows: 0, error: message });
      }
    }
    return out;
  }

  /** Replaces the stored days [from, to] of `source` with `rows` (one transaction). */
  async ingest(
    source: SearchSource,
    from: string,
    to: string,
    rows: SearchQueryStat[],
  ): Promise<void> {
    const merged = new Map<string, SearchQueryStat>();
    for (const r of rows) {
      if (r.date < from || r.date > to) continue;
      // Case variants of a query are one row (the PK is case-sensitive, providers aren't always).
      const k = `${r.date}\u0000${r.query}`;
      const prev = merged.get(k);
      merged.set(
        k,
        prev
          ? {
              ...prev,
              clicks: prev.clicks + r.clicks,
              impressions: prev.impressions + r.impressions,
              position: prev.position ?? r.position,
            }
          : r,
      );
    }
    const data = [...merged.values()].map((r) => ({
      source,
      date: new Date(`${r.date}T00:00:00Z`),
      query: r.query,
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
    }));
    await this.prisma.$transaction(async (tx) => {
      await tx.searchQueryDaily.deleteMany({
        where: {
          source,
          date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
      });
      for (let i = 0; i < data.length; i += 5_000)
        await tx.searchQueryDaily.createMany({ data: data.slice(i, i + 5_000) });
    });
  }

  async report(
    source: SearchSource,
    days: number,
    now = new Date(),
  ): Promise<AdminSearchQueriesDto> {
    if (!SEARCH_SOURCES.includes(source)) throw new DomainError('VALIDATION_FAILED');
    const end = new Date(`${tashkentDay(now, -1)}T00:00:00Z`);
    const start = new Date(end.getTime() - (days - 1) * DAY_MS);
    const prevEnd = new Date(start.getTime() - DAY_MS);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY_MS);
    const [state, current, previous, items] = await Promise.all([
      this.state(source),
      this.totals(source, start, end),
      this.totals(source, prevStart, prevEnd),
      this.prisma.$queryRaw<
        { query: string; clicks: bigint; impressions: bigint; position: number | null }[]
      >`
        SELECT "query", SUM("clicks")::bigint AS clicks, SUM("impressions")::bigint AS impressions,
               SUM("position" * "impressions") / NULLIF(SUM(CASE WHEN "position" IS NULL THEN 0 ELSE "impressions" END), 0) AS position
        FROM "SearchQueryDaily"
        WHERE "source" = ${source} AND "date" BETWEEN ${ymd(start)}::date AND ${ymd(end)}::date
        GROUP BY "query"
        ORDER BY clicks DESC, impressions DESC, "query" ASC
        LIMIT 50`,
    ]);
    return {
      source,
      status: state.status,
      days,
      lastSyncedAt: state.lastSyncedAt,
      totals: current ?? { clicks: 0, impressions: 0, ctr: 0, position: null },
      previous,
      items: items.map((r) => {
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        return {
          query: r.query,
          clicks,
          impressions,
          ctr: impressions ? clicks / impressions : 0,
          position: r.position === null ? null : Math.round(Number(r.position) * 10) / 10,
        };
      }),
    };
  }

  private async totals(
    source: string,
    start: Date,
    end: Date,
  ): Promise<AdminSearchTotalsDto | null> {
    const [row] = await this.prisma.$queryRaw<
      { n: bigint; clicks: bigint | null; impressions: bigint | null; position: number | null }[]
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS n, SUM("clicks")::bigint AS clicks, SUM("impressions")::bigint AS impressions,
             SUM("position" * "impressions") / NULLIF(SUM(CASE WHEN "position" IS NULL THEN 0 ELSE "impressions" END), 0) AS position
      FROM "SearchQueryDaily"
      WHERE "source" = ${source} AND "date" BETWEEN ${ymd(start)}::date AND ${ymd(end)}::date`);
    if (!row || Number(row.n) === 0) return null;
    const clicks = Number(row.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    return {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: row.position === null ? null : Math.round(Number(row.position) * 10) / 10,
    };
  }
}
