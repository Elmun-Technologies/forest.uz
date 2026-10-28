import {
  type AdPlatform,
  type AdSpendImportResultDto,
  type AdSpendRow,
  type AdSpendSummaryDto,
  type AdSpendSummaryQuery,
  analyticsPeriod,
  DomainError,
  parseAdSpendCsv,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuditActor } from '../audit/audit.service';
import { AuditService } from '../audit/audit.service';
import { type AdSpendSource, FakeAdSpendSource } from './ad-spend-source';
import { periodDto } from './reports.service';
import { num, soum } from './sql';

const CHUNK = 500;

/** `AdSpendDaily` import (CSV / adapter) and the A2 spend summary (CLAUDE.md §6 "Ad spend"). */
@Injectable()
export class AdSpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Adapter for a platform: the fake in PROVIDERS_MODE=fake, else not configured (none yet). */
  source(platform: AdPlatform): AdSpendSource {
    if (this.env.PROVIDERS_MODE === 'fake') return new FakeAdSpendSource(platform);
    throw new DomainError('INTEGRATION_NOT_CONFIGURED', { integration: `${platform}_ads_spend` });
  }

  async importCsv(actor: AuditActor, csv: string): Promise<AdSpendImportResultDto> {
    const { rows, errors } = parseAdSpendCsv(csv);
    if (errors.length)
      throw new DomainError('AD_SPEND_CSV_INVALID', {
        errors: errors.slice(0, 50),
        total: errors.length,
      });
    return this.upsert(actor, rows, { via: 'csv' });
  }

  async sync(
    actor: AuditActor,
    input: { platform: AdPlatform; from: string; to: string },
  ): Promise<AdSpendImportResultDto> {
    const rows = await this.source(input.platform).fetchDaily(input.from, input.to);
    return this.upsert(actor, rows, { via: 'api', ...input });
  }

  /** Idempotent: one row per (date, platform, campaign_id); re-imports overwrite. Audited. */
  private async upsert(
    actor: AuditActor,
    rows: AdSpendRow[],
    meta: Record<string, string>,
  ): Promise<AdSpendImportResultDto> {
    const days = rows.map((r) => r.date).sort();
    const result: AdSpendImportResultDto = {
      rows: rows.length,
      inserted: 0,
      updated: 0,
      firstDay: days[0] ?? null,
      lastDay: days.at(-1) ?? null,
    };
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const values = rows
            .slice(i, i + CHUNK)
            .map(
              (r) =>
                Prisma.sql`(${r.date}::date, ${r.platform}, ${r.campaignId}, ${r.campaign}, ${r.adset}, ${r.spendTiyin}, ${r.impressions}, ${r.clicks})`,
            );
          const res = await tx.$queryRaw<{ inserted: boolean }[]>`
            INSERT INTO "AdSpendDaily"
              (date, platform, "campaignId", campaign, adset, "spendTiyin", impressions, clicks)
            VALUES ${Prisma.join(values)}
            ON CONFLICT (date, platform, "campaignId") DO UPDATE SET
              campaign = EXCLUDED.campaign, adset = EXCLUDED.adset,
              "spendTiyin" = EXCLUDED."spendTiyin", impressions = EXCLUDED.impressions,
              clicks = EXCLUDED.clicks
            RETURNING (xmax = 0) AS inserted`;
          for (const r of res) {
            if (r.inserted) result.inserted++;
            else result.updated++;
          }
        }
        await this.audit.record(
          actor,
          {
            action: 'adspend.import',
            entity: 'AdSpendDaily',
            after: {
              ...meta,
              rows: result.rows,
              inserted: result.inserted,
              updated: result.updated,
              firstDay: result.firstDay,
              lastDay: result.lastDay,
              platforms: [...new Set(rows.map((r) => r.platform))],
            },
          },
          tx,
        );
      },
      { timeout: 60_000 },
    );
    return result;
  }

  async summary(q: AdSpendSummaryQuery, now = new Date()): Promise<AdSpendSummaryDto> {
    const p = analyticsPeriod(q.days, q.end, now);
    const [platforms, campaigns, [last]] = await Promise.all([
      this.prisma.$queryRaw<
        { platform: string; spend: unknown; impressions: unknown; clicks: unknown }[]
      >`
        SELECT platform, SUM("spendTiyin") AS spend, SUM(impressions) AS impressions,
               SUM(clicks) AS clicks
        FROM "AdSpendDaily" WHERE date >= ${p.firstDay}::date AND date <= ${p.lastDay}::date
        GROUP BY platform ORDER BY SUM("spendTiyin") DESC`,
      this.prisma.$queryRaw<
        {
          platform: string;
          campaignId: string;
          campaign: string;
          spend: unknown;
          clicks: unknown;
          last: string;
        }[]
      >`
        SELECT platform, "campaignId", max(campaign) AS campaign, SUM("spendTiyin") AS spend,
               SUM(clicks) AS clicks, to_char(max(date), 'YYYY-MM-DD') AS last
        FROM "AdSpendDaily" WHERE date >= ${p.firstDay}::date AND date <= ${p.lastDay}::date
        GROUP BY platform, "campaignId" ORDER BY SUM("spendTiyin") DESC LIMIT 100`,
      this.prisma.$queryRaw<{ last: string | null }[]>`
        SELECT to_char(max(date), 'YYYY-MM-DD') AS last FROM "AdSpendDaily"`,
    ]);
    return {
      period: periodDto(p),
      platforms: platforms.map((x) => ({
        platform: x.platform,
        spendSoum: soum(x.spend),
        impressions: num(x.impressions),
        clicks: num(x.clicks),
      })),
      campaigns: campaigns.map((x) => ({
        platform: x.platform,
        campaignId: x.campaignId,
        campaign: x.campaign,
        spendSoum: soum(x.spend),
        clicks: num(x.clicks),
        lastDay: x.last,
      })),
      lastImportDay: last?.last ?? null,
    };
  }
}
