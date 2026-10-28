import {
  type AttentionItemDto,
  CUSTOMER_SEGMENT_RULES,
  type DashboardDto,
  type DashboardQuery,
  DEFAULT_ATTRIBUTION_MODEL,
  type KpisDto,
  type LatestOrderDto,
  type Permission,
  ratio,
  SLA_OPEN_STATUSES,
  SLA_RISK_WINDOW_MS,
  t,
  type TopProductDto,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { Injectable } from '@nestjs/common';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { RealtimeService } from './realtime.service';
import {
  type CoreTotals,
  currentRange,
  periodDto,
  previousRange,
  type Range,
  ReportsService,
} from './reports.service';
import { isPurchase, num, soum } from './sql';

const DAY_MS = 86_400_000;

/** Anomaly rule: bounce rate of the last 3 days vs the 14 days before, per device. */
export const BOUNCE_ANOMALY = {
  recentDays: 3,
  baselineDays: 14,
  minSessions: 50,
  minDeltaPp: 0.05,
};

function kpis(cur: CoreTotals, prev: CoreTotals): KpisDto {
  const cr = (x: CoreTotals) => ratio(x.orders, x.sessions) ?? 0;
  const aov = (x: CoreTotals) => (x.orders ? soum(x.revenueTiyin) / x.orders : 0);
  return {
    sessions: { value: cur.sessions, previous: prev.sessions },
    visitors: { value: cur.visitors, previous: prev.visitors },
    orders: { value: cur.orders, previous: prev.orders },
    revenueSoum: { value: soum(cur.revenueTiyin), previous: soum(prev.revenueTiyin) },
    conversionRate: { value: cr(cur), previous: prev.sessions ? cr(prev) : null },
    aovSoum: { value: Math.round(aov(cur)), previous: prev.orders ? Math.round(aov(prev)) : null },
    leads: { value: cur.leads, previous: prev.leads },
  };
}

/**
 * A1 Dashboard (docs/08). Analytics blocks need `analytics.view`; operational ones their own
 * permission (CLAUDE.md §6) — blocks the actor can't see are null / left out, never computed.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  async dashboard(
    q: DashboardQuery,
    permissions: readonly Permission[],
    now = new Date(),
  ): Promise<DashboardDto> {
    const can = (p: Permission) => permissions.includes(p);
    const analytics = can('analytics.view');
    const p = this.reports.period(q, now);
    const r = currentRange(p);
    const model = DEFAULT_ATTRIBUTION_MODEL;
    const none = Promise.resolve(null);
    const [activeNow, cur, prev, visits, funnel, channels, topProducts, latestOrders, attention] =
      await Promise.all([
        analytics ? this.realtime.activeNow(now) : none,
        analytics ? this.reports.totals(r) : none,
        analytics ? this.reports.totals(previousRange(p)) : none,
        analytics ? this.reports.daily(p) : none,
        analytics ? this.reports.funnelSteps(r) : none,
        analytics ? this.reports.channels(r, {}, model) : none,
        analytics ? this.topProducts(r) : none,
        can('orders.view') ? this.latestOrders() : none,
        this.attention(permissions, now),
      ]);
    return {
      period: periodDto(p),
      activeNow,
      kpis: cur && prev ? kpis(cur, prev) : null,
      visits,
      funnel,
      channels: channels ? channels.slice(0, 8) : null,
      topProducts,
      latestOrders,
      attention,
    };
  }

  /** Best sellers of the range by revenue; CR = purchases with it / sessions viewing its page. */
  async topProducts(r: Range, limit = 5): Promise<TopProductDto[]> {
    const rows = await this.prisma.$queryRaw<
      {
        productId: string;
        slug: string;
        name: unknown;
        image: string | null;
        units: bigint;
        revenue: unknown;
        orders: bigint;
        views: bigint;
      }[]
    >`
      WITH pu AS (
        SELECT o.id FROM "Order" o
        WHERE o."createdAt" >= ${r.from} AND o."createdAt" < ${r.to} AND ${isPurchase('o')}),
      it AS (
        SELECT v."productId", SUM(i.qty) AS units,
               SUM(i."priceTiyin" * i.qty - i."discountTiyin") AS revenue,
               count(DISTINCT i."orderId") AS orders
        FROM "OrderItem" i JOIN pu ON pu.id = i."orderId" JOIN "Variant" v ON v.id = i."variantId"
        GROUP BY v."productId" ORDER BY revenue DESC, units DESC LIMIT ${limit})
      SELECT it."productId", p.slug, p.name, it.units, it.revenue, it.orders,
        (SELECT f.key FROM "ProductImage" pi JOIN "File" f ON f.id = pi."fileId"
          WHERE pi."productId" = p.id AND NOT pi."isVideo" ORDER BY pi.sort LIMIT 1) AS image,
        (SELECT count(DISTINCT e."sessionId") FROM "Event" e
          WHERE e.ts >= ${r.from} AND e.ts < ${r.to} AND e.name = 'page_view'
            AND e.path IN ('/uz/p/' || p.slug, '/ru/p/' || p.slug, '/p/' || p.slug)) AS views
      FROM it JOIN "Product" p ON p.id = it."productId"
      ORDER BY it.revenue DESC, it.units DESC`;
    return rows.map((x) => ({
      productId: x.productId,
      slug: x.slug,
      name: t(x.name, 'uz'),
      imageUrl: x.image ? this.files.publicUrl(x.image) : null,
      units: num(x.units),
      revenueSoum: soum(x.revenue),
      views: num(x.views),
      conversionRate: ratio(num(x.orders), num(x.views)),
    }));
  }

  async latestOrders(limit = 5): Promise<LatestOrderDto[]> {
    const orders = await this.prisma.order.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        number: true,
        createdAt: true,
        status: true,
        paymentMethod: true,
        carrier: true,
        totalTiyin: true,
        contactName: true,
        payments: { select: { status: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    const prefer = ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'];
    return orders.map((o) => ({
      number: o.number,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus:
        (o.payments.find((x) => prefer.includes(x.status)) ?? o.payments[0])?.status ?? null,
      carrier: o.carrier,
      totalSoum: soum(o.totalTiyin),
      customerName: o.contactName && o.contactName !== '—' ? o.contactName : null,
    }));
  }

  /** "Diqqat talab qiladi", most urgent first; each item behind its own permission. */
  async attention(
    permissions: readonly Permission[],
    now = new Date(),
  ): Promise<AttentionItemDto[]> {
    const can = (p: Permission) => permissions.includes(p);
    const out: AttentionItemDto[] = [];
    if (can('orders.view')) {
      const statuses = [...SLA_OPEN_STATUSES];
      const [overdue, atRisk] = await Promise.all([
        this.prisma.order.count({ where: { status: { in: statuses }, slaDueAt: { lt: now } } }),
        this.prisma.order.count({
          where: {
            status: { in: statuses },
            slaDueAt: { gte: now, lt: new Date(now.getTime() + SLA_RISK_WINDOW_MS) },
          },
        }),
      ]);
      if (overdue + atRisk > 0)
        out.push({ kind: 'sla_risk', severity: 'critical', overdue, atRisk });
    }
    if (can('products.view')) {
      const low = await this.prisma.$queryRaw<
        { sku: string; name: unknown; label: unknown; available: number }[]
      >`
        SELECT v.sku, p.name, v.label, (v.stock - v.reserved) AS available
        FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
        WHERE v.active AND p.status = 'ACTIVE'
          AND v.stock - v.reserved > 0 AND v.stock - v.reserved < v."lowStockAt"
        ORDER BY (v.stock - v.reserved), v.sku`;
      if (low.length)
        out.push({
          kind: 'low_stock',
          severity: 'warning',
          count: low.length,
          items: low.slice(0, 3).map((x) => ({
            sku: x.sku,
            name: t(x.name, 'uz'),
            label: t(x.label, 'uz') || null,
            available: num(x.available),
          })),
        });
    }
    if (can('analytics.view')) {
      const anomaly = await this.bounceAnomaly(now);
      if (anomaly) out.push(anomaly);
      const carts = await this.abandonedCarts(now);
      if (carts > 0)
        out.push({
          kind: 'opportunity',
          severity: 'good',
          abandonedCarts: carts,
          days: CUSTOMER_SEGMENT_RULES.abandonedDays,
        });
    }
    return out;
  }

  /** Largest rise of a device's bounce rate (recent days vs baseline), if over the threshold. */
  async bounceAnomaly(now = new Date()): Promise<AttentionItemDto | null> {
    const a = BOUNCE_ANOMALY;
    const recentFrom = new Date(now.getTime() - a.recentDays * DAY_MS);
    const baseFrom = new Date(recentFrom.getTime() - a.baselineDays * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      { device: string; rs: bigint; rb: bigint; bs: bigint; bb: bigint }[]
    >`
      SELECT s.device,
             count(*) FILTER (WHERE s."startedAt" >= ${recentFrom}) AS rs,
             count(*) FILTER (WHERE s."startedAt" >= ${recentFrom} AND s.bounced) AS rb,
             count(*) FILTER (WHERE s."startedAt" < ${recentFrom}) AS bs,
             count(*) FILTER (WHERE s."startedAt" < ${recentFrom} AND s.bounced) AS bb
      FROM "Session" s WHERE s."startedAt" >= ${baseFrom} AND s."startedAt" < ${now}
      GROUP BY s.device`;
    const found = rows
      .filter((x) => num(x.rs) >= a.minSessions && num(x.bs) >= a.minSessions)
      .map((x) => {
        const recentRate = num(x.rb) / num(x.rs);
        const baselineRate = num(x.bb) / num(x.bs);
        return { device: x.device, recentRate, baselineRate, deltaPp: recentRate - baselineRate };
      })
      .filter((x) => x.deltaPp >= a.minDeltaPp)
      .sort((x, y) => y.deltaPp - x.deltaPp)[0];
    return found
      ? {
          kind: 'anomaly',
          severity: 'warning',
          metric: 'bounce_rate',
          recentDays: a.recentDays,
          ...found,
        }
      : null;
  }

  /** Carts in the A4 "abandoned" window (same rule as the customers segment). */
  async abandonedCarts(now = new Date()): Promise<number> {
    const minutes = (await this.settings.get('messaging.rules')).abandonedCartMinutes;
    const from = new Date(now.getTime() - CUSTOMER_SEGMENT_RULES.abandonedDays * DAY_MS);
    const to = new Date(now.getTime() - minutes * 60_000);
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM "Cart" c
      WHERE c.status <> 'CONVERTED' AND c."updatedAt" >= ${from} AND c."updatedAt" <= ${to}
        AND EXISTS (SELECT 1 FROM "CartItem" ci WHERE ci."cartId" = c.id)
        AND NOT EXISTS (SELECT 1 FROM "Order" o
          WHERE o."customerId" = c."customerId" AND o."createdAt" >= c."updatedAt")`);
    return num(row?.n);
  }
}
