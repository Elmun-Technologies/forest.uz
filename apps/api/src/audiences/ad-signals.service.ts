import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AD_SIGNAL_EVENTS,
  AD_SIGNAL_INTEGRATION,
  AD_SIGNAL_PLATFORM_EVENTS,
  AD_SIGNAL_PLATFORMS,
  AD_SIGNAL_RULES,
  type AdSignalEventName,
  type AdSignalPlatform,
  adSignalBackoffMs,
  tiyinToSoum,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import type { AdConversion } from '../integrations/providers/ads/types';
import { PrismaService } from '../prisma/prisma.service';
import { AdsProvidersService } from './ads-providers.service';

export const AD_SIGNALS_CURSOR = 'ads.signals';
const PAGE = 1_000;
const MAX_PAGES = 20;
const SEND_LEASE_MS = 5 * 60_000;

interface EventRow {
  id: string;
  ts: Date;
  name: string;
  customerId: string | null;
}

interface SignalRow {
  id: string;
  platform: string;
  eventId: string;
  eventName: string;
  eventTs: Date;
  customerId: string | null;
  attempts: number;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Event props → value in so'm (purchase: tiyin string; cart events: so'm numbers). */
export function signalValueSoum(name: string, props: unknown): number | null {
  const p = (props ?? {}) as Record<string, unknown>;
  if (name === 'purchase' && typeof p.valueTiyin === 'string' && /^\d+$/.test(p.valueTiyin))
    return tiyinToSoum(BigInt(p.valueTiyin));
  if (name === 'begin_checkout' && typeof p.valueSoum === 'number') return p.valueSoum;
  if (name === 'add_to_cart' && typeof p.priceSoum === 'number')
    return p.priceSoum * (typeof p.qty === 'number' ? p.qty : 1);
  return null;
}

/**
 * Server-side ad signals (CLAUDE.md §6 "Ad signals"): an outbox over the Event table.
 * `collect` turns new lead/add_to_cart/begin_checkout/purchase events of consenting customers into
 * `AdSignal` rows (unique per platform + event id); `send` delivers due rows with backoff.
 */
@Injectable()
export class AdSignalsService {
  private readonly logger = new Logger('AdSignals');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: AdsProvidersService,
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async connectedPlatforms(): Promise<AdSignalPlatform[]> {
    const keys = await this.ads.connectedKeys(Object.values(AD_SIGNAL_INTEGRATION));
    return AD_SIGNAL_PLATFORMS.filter((p) => keys.has(AD_SIGNAL_INTEGRATION[p]));
  }

  /** Customers (of `ids`) whose latest ADS_MATCHING consent is granted. */
  private async consenting(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.$queryRaw<{ id: string; granted: boolean }[]>`
      SELECT DISTINCT ON (cs."customerId") cs."customerId" AS id, cs.granted
      FROM "Consent" cs
      WHERE cs."customerId" = ANY(${ids}) AND cs.channel = 'ADS_MATCHING'::"ConsentChannel"
      ORDER BY cs."customerId", cs."createdAt" DESC, cs.id DESC`;
    return new Set(rows.filter((r) => r.granted).map((r) => r.id));
  }

  /** Reads events after the cursor and queues signals; returns how many were queued. */
  async collect(now = new Date()): Promise<{ events: number; queued: number }> {
    const upper = new Date(now.getTime() - AD_SIGNAL_RULES.lagMs);
    const floor = new Date(now.getTime() - AD_SIGNAL_RULES.maxAgeMs);
    const cursor = await this.prisma.jobCursor.findUnique({ where: { key: AD_SIGNALS_CURSOR } });
    // Start at the cursor, but never later than the re-scan window (late, back-dated events) and
    // never earlier than the max age (first run: only the re-scan window, no older history).
    const rescanFrom = new Date(upper.getTime() - AD_SIGNAL_RULES.rescanMs);
    let afterTs = cursor && cursor.ts < rescanFrom ? cursor.ts : rescanFrom;
    let afterId = cursor && cursor.ts < rescanFrom ? cursor.ref : '';
    if (afterTs < floor) {
      afterTs = floor;
      afterId = '';
    }
    const platforms = await this.connectedPlatforms();
    let events = 0;
    let queued = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await this.prisma.$queryRaw<EventRow[]>(Prisma.sql`
        SELECT e.id, e.ts, e.name, COALESCE(e."customerId", v."customerId") AS "customerId"
        FROM "Event" e LEFT JOIN "Visitor" v ON v."anonymousId" = e."anonymousId"
        WHERE e.name IN (${Prisma.join([...AD_SIGNAL_EVENTS])})
          AND e.ts >= ${afterTs} AND e.ts <= ${upper}
          AND (e.ts > ${afterTs} OR e.id > ${afterId})
        ORDER BY e.ts, e.id
        LIMIT ${PAGE}`);
      if (!rows.length) break;
      events += rows.length;
      if (platforms.length) {
        const consent = await this.consenting([
          ...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x)),
        ]);
        const data: Prisma.AdSignalCreateManyInput[] = [];
        for (const r of rows) {
          if (!r.customerId || !consent.has(r.customerId)) continue;
          for (const platform of platforms)
            if (AD_SIGNAL_PLATFORM_EVENTS[platform].includes(r.name as AdSignalEventName))
              data.push({
                platform,
                eventId: r.id,
                eventName: r.name,
                eventTs: r.ts,
                customerId: r.customerId,
              });
        }
        if (data.length)
          queued += (await this.prisma.adSignal.createMany({ data, skipDuplicates: true })).count;
      }
      const last = rows[rows.length - 1]!;
      afterTs = last.ts;
      afterId = last.id;
      if (rows.length < PAGE) break;
    }
    await this.prisma.jobCursor.upsert({
      where: { key: AD_SIGNALS_CURSOR },
      create: { key: AD_SIGNALS_CURSOR, ts: afterTs, ref: afterId },
      update: { ts: afterTs, ref: afterId },
    });
    return { events, queued };
  }

  /** Claims due rows (skip-locked lease, so parallel workers never send one row twice). */
  private claim(now: Date): Promise<SignalRow[]> {
    return this.prisma.$queryRaw<SignalRow[]>`
      UPDATE "AdSignal" a SET status = 'SENDING', "nextAttemptAt" = ${new Date(now.getTime() + SEND_LEASE_MS)}
      WHERE a.id IN (
        SELECT id FROM "AdSignal"
        WHERE status IN ('PENDING', 'FAILED', 'SENDING') AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt" LIMIT ${AD_SIGNAL_RULES.batch * 3}
        FOR UPDATE SKIP LOCKED)
      RETURNING a.id, a.platform, a."eventId", a."eventName", a."eventTs", a."customerId", a.attempts`;
  }

  private async conversions(rows: SignalRow[]): Promise<Map<string, AdConversion>> {
    const out = new Map<string, AdConversion>();
    if (!rows.length) return out;
    const pairs = [...new Map(rows.map((r) => [r.eventId, r])).values()];
    const events = await this.prisma.$queryRaw<
      {
        id: string;
        ts: Date;
        name: string;
        path: string;
        props: unknown;
        sessionId: string;
        clickIds: unknown;
        startedAt: Date | null;
      }[]
    >(Prisma.sql`
      SELECT e.id, e.ts, e.name, e.path, e.props, e."sessionId", s."clickIds", s."startedAt"
      FROM "Event" e LEFT JOIN "Session" s ON s.id = e."sessionId"
      WHERE (e.id, e.ts) IN (${Prisma.join(pairs.map((p) => Prisma.sql`(${p.eventId}, ${p.eventTs})`))})`);
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
    const customers = new Map(
      (
        await this.prisma.customer.findMany({
          where: { id: { in: customerIds }, deletedAt: null },
          select: { id: true, phone: true },
        })
      ).map((c) => [c.id, c.phone]),
    );
    const base = this.env.APP_URL.replace(/\/+$/, '');
    const byEvent = new Map(rows.map((r) => [r.eventId, r]));
    for (const e of events) {
      const row = byEvent.get(e.id);
      const ids = (e.clickIds ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof ids[k] === 'string' ? (ids[k] as string) : undefined);
      const props = (e.props ?? {}) as Record<string, unknown>;
      out.set(e.id, {
        eventId: e.id,
        name: e.name as AdSignalEventName,
        at: e.ts,
        url: e.path ? `${base}${e.path}` : null,
        valueSoum: signalValueSoum(e.name, e.props),
        orderNumber: typeof props.orderNumber === 'string' ? props.orderNumber : null,
        phone: row?.customerId ? (customers.get(row.customerId) ?? null) : null,
        customerId: row?.customerId ?? null,
        clickIds: { fbclid: str('fbclid'), gclid: str('gclid'), ttclid: str('ttclid') },
        clickAt: e.startedAt,
      });
    }
    return out;
  }

  /** Sends due signals; returns counts per outcome. */
  async send(now = new Date()) {
    const rows = await this.claim(now);
    const totals = { sent: 0, failed: 0, skipped: 0, dead: 0, deferred: 0 };
    if (!rows.length) return totals;
    const consent = await this.consenting([
      ...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x)),
    ]);
    const conversions = await this.conversions(rows);
    for (const platform of AD_SIGNAL_PLATFORMS) {
      const mine = rows.filter((r) => r.platform === platform);
      if (!mine.length) continue;
      const provider = await this.ads.conversions(platform);
      const skip: { row: SignalRow; reason: string }[] = [];
      const ready: SignalRow[] = [];
      const tooOld = now.getTime() - AD_SIGNAL_RULES.maxAgeMs;
      const defer: SignalRow[] = [];
      for (const r of mine) {
        if (!provider) {
          // A disconnected platform may come back (re-connect, credentials fix): wait, unless the
          // event is already too old for the platform.
          if (r.eventTs.getTime() < tooOld)
            skip.push({ row: r, reason: 'integration not connected' });
          else defer.push(r);
        } else if (!r.customerId || !consent.has(r.customerId))
          skip.push({ row: r, reason: 'ads consent withdrawn' });
        else if (!conversions.has(r.eventId)) skip.push({ row: r, reason: 'event not found' });
        else ready.push(r);
      }
      await this.finish(
        skip.map((s) => ({ row: s.row, outcome: 'SKIPPED', reason: s.reason })),
        now,
      );
      if (defer.length)
        await this.prisma.adSignal.updateMany({
          where: { id: { in: defer.map((r) => r.id) } },
          data: {
            status: 'PENDING',
            lastError: 'integration not connected',
            nextAttemptAt: new Date(now.getTime() + AD_SIGNAL_RULES.deferMs),
          },
        });
      totals.deferred += defer.length;
      totals.skipped += skip.length;
      if (!provider || !ready.length) continue;
      let result;
      try {
        result = await provider.send(ready.map((r) => conversions.get(r.eventId)!));
      } catch (e) {
        const reason = errorText(e);
        result = { failed: new Map(ready.map((r) => [r.eventId, reason])), skipped: new Map() };
      }
      const outcomes = ready.map((row) => {
        const failed = result.failed.get(row.eventId);
        const skipped = result.skipped.get(row.eventId);
        if (skipped) return { row, outcome: 'SKIPPED' as const, reason: skipped };
        if (failed) return { row, outcome: 'FAILED' as const, reason: failed };
        return { row, outcome: 'SENT' as const, reason: null };
      });
      const stats = await this.finish(outcomes, now);
      totals.sent += stats.SENT;
      totals.failed += stats.FAILED;
      totals.dead += stats.DEAD;
      totals.skipped += stats.SKIPPED;
      const firstError = outcomes.find((o) => o.outcome === 'FAILED')?.reason;
      await this.integrations
        .log(AD_SIGNAL_INTEGRATION[platform], {
          direction: 'OUT',
          kind: 'signals.send',
          ok: stats.FAILED + stats.DEAD === 0,
          message:
            `sent ${stats.SENT}, failed ${stats.FAILED}, dead ${stats.DEAD}, skipped ${stats.SKIPPED}` +
            (firstError ? ` — ${firstError}` : ''),
        })
        .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
    }
    return totals;
  }

  private async finish(
    outcomes: { row: SignalRow; outcome: 'SENT' | 'FAILED' | 'SKIPPED'; reason: string | null }[],
    now: Date,
  ): Promise<Record<'SENT' | 'FAILED' | 'SKIPPED' | 'DEAD', number>> {
    const stats = { SENT: 0, FAILED: 0, SKIPPED: 0, DEAD: 0 };
    for (const o of outcomes) {
      const attempts = o.row.attempts + (o.outcome === 'SKIPPED' ? 0 : 1);
      const status =
        o.outcome === 'FAILED' && attempts >= AD_SIGNAL_RULES.maxAttempts ? 'DEAD' : o.outcome;
      stats[status]++;
      await this.prisma.adSignal.update({
        where: { id: o.row.id },
        data: {
          status,
          attempts,
          lastError: o.reason?.slice(0, 300) ?? null,
          sentAt: status === 'SENT' ? now : undefined,
          nextAttemptAt:
            status === 'FAILED' ? new Date(now.getTime() + adSignalBackoffMs(attempts)) : now,
        },
      });
    }
    return stats;
  }

  /** A8 panel: last 24 h per platform. */
  async summary(now = new Date()) {
    const since = new Date(now.getTime() - 86_400_000);
    const rows = await this.prisma.adSignal.groupBy({
      by: ['platform', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const connected = await this.connectedPlatforms();
    return AD_SIGNAL_PLATFORMS.map((platform) => {
      const n = (statuses: string[]) =>
        rows
          .filter((r) => r.platform === platform && statuses.includes(r.status))
          .reduce((a, r) => a + r._count._all, 0);
      return {
        platform,
        connected: connected.includes(platform),
        sent: n(['SENT']),
        failed: n(['FAILED', 'DEAD']),
        pending: n(['PENDING', 'SENDING']),
      };
    });
  }
}
