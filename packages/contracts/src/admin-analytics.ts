/**
 * Admin A1 Dashboard / A2 Analytics / A5–A7 journeys (docs/07, docs/08). Zod-free: DTO types,
 * period helpers and computed insights the admin UI imports from `@forest/contracts/core`. Input
 * schemas live in `schemas/admin-analytics.ts`. Definitions (purchase, CR, leads…): CLAUDE.md §6.
 */
import type { AttributionModel, AttributionShares, TouchKind } from './attribution';
import type { OrderStatus, PaymentMethod } from './order-state';
import { fromTashkent, toTashkentParts } from './time';

export const ANALYTICS_PERIODS = [7, 14, 30, 90] as const;
export type AnalyticsPeriodDays = (typeof ANALYTICS_PERIODS)[number];
export const DASHBOARD_PERIODS = [7, 14, 30] as const;

export const ANALYTICS_DEVICES = ['mobile', 'desktop', 'tablet'] as const;
export type AnalyticsDevice = (typeof ANALYTICS_DEVICES)[number];

export const ANALYTICS_TABS = [
  'realtime',
  'sources',
  'pages',
  'events',
  'funnel',
  'devices',
  'cohorts',
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

/** Funnel steps (docs/07): sessions that did each step in the period (open funnel). */
export const FUNNEL_STEPS = [
  'visit',
  'view_item',
  'add_to_cart',
  'begin_checkout',
  'purchase',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Realtime window (docs/07 "active users (last 30 min)"). */
export const REALTIME_WINDOW_MINUTES = 30;

/**
 * Ad platforms of `AdSpendDaily.platform` and the utm sources that belong to each (lower-case).
 * Spend joins traffic through this map (CLAUDE.md §6).
 */
export const AD_PLATFORM_SOURCES = {
  meta: ['facebook', 'instagram', 'fb', 'ig', 'meta', 'messenger', 'audience_network'],
  google: ['google', 'youtube', 'adwords', 'google_ads', 'gads'],
  tiktok: ['tiktok'],
  yandex: ['yandex', 'yandex_direct', 'ya'],
} as const satisfies Record<string, readonly string[]>;
export type AdPlatform = keyof typeof AD_PLATFORM_SOURCES;
export const AD_PLATFORMS = Object.keys(AD_PLATFORM_SOURCES) as AdPlatform[];

export function adPlatformOfSource(source: string | null | undefined): AdPlatform | null {
  const s = (source ?? '').trim().toLowerCase();
  for (const p of AD_PLATFORMS)
    if ((AD_PLATFORM_SOURCES[p] as readonly string[]).includes(s)) return p;
  return null;
}

/** Events that are plumbing, not goals: left out of A2 "Hodisalar va maqsadlar". */
export const TECHNICAL_EVENTS: readonly string[] = [
  'page_view',
  'click',
  'scroll_depth',
  'web_vitals',
  'exit',
  'rage_click',
  'dead_click',
  'js_error',
  'form_error',
];

/** Funnel / checkout events: their lift is trivially high, so they never drive the insight. */
export const FUNNEL_EVENTS: readonly string[] = [
  'view_item',
  'add_to_cart',
  'view_cart',
  'remove_from_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
];

// ───────────────────────── Periods (Asia/Tashkent days) ─────────────────────────

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of the Tashkent day containing `date`. */
export function tashkentDayKey(date: Date): string {
  const p = toTashkentParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Midnight (Tashkent) of a `YYYY-MM-DD` day as a UTC instant. */
export function tashkentDayKeyStart(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`invalid day "${day}", expected YYYY-MM-DD`);
  return fromTashkent(Number(m[1]), Number(m[2]), Number(m[3]));
}

export interface AnalyticsPeriod {
  days: number;
  /** First and last Tashkent day (inclusive). */
  firstDay: string;
  lastDay: string;
  /** [from, to) instants. */
  from: Date;
  to: Date;
  /** The N days before (compare). */
  prevFrom: Date;
  prevTo: Date;
  /** Every day key in order. */
  dayKeys: string[];
}

/** N whole Tashkent days ending on `endDay` (default: today). */
export function analyticsPeriod(days: number, endDay?: string, now = new Date()): AnalyticsPeriod {
  const lastDay = endDay ?? tashkentDayKey(now);
  const to = new Date(tashkentDayKeyStart(lastDay).getTime() + DAY_MS);
  const from = new Date(to.getTime() - days * DAY_MS);
  const dayKeys = Array.from({ length: days }, (_, i) =>
    tashkentDayKey(new Date(from.getTime() + i * DAY_MS)),
  );
  return {
    days,
    firstDay: dayKeys[0]!,
    lastDay,
    from,
    to,
    prevFrom: new Date(from.getTime() - days * DAY_MS),
    prevTo: from,
    dayKeys,
  };
}

/** n / d, or null when there is no denominator. */
export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Relative change (0.14 = +14 %), null when the previous value is 0 / unknown. */
export function relativeDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

// ───────────────────────── Insight (A2 Events & goals) ─────────────────────────

export interface GoalRow {
  name: string;
  sessions: number;
  purchasingSessions: number;
}

export interface GoalInsight {
  name: string;
  /** Purchase rate of sessions that did the event / overall purchase rate. */
  lift: number;
  rate: number;
  overallRate: number;
  sessions: number;
  direction: 'up' | 'down';
}

/**
 * The strongest computed finding: the goal event whose sessions buy most (lift ≥ 1.5) — or, when
 * none, the one whose sessions buy least (lift ≤ 0.5, a leak). Needs `minSessions` sessions
 * doing the event and a non-zero overall rate; funnel/technical events never count.
 */
export function goalInsight(
  rows: readonly GoalRow[],
  overall: { sessions: number; purchasingSessions: number },
  minSessions = 30,
): GoalInsight | null {
  const overallRate = ratio(overall.purchasingSessions, overall.sessions);
  if (!overallRate) return null;
  const scored = rows
    .filter(
      (r) =>
        r.sessions >= minSessions &&
        !TECHNICAL_EVENTS.includes(r.name) &&
        !FUNNEL_EVENTS.includes(r.name),
    )
    .map((r) => {
      const rate = r.purchasingSessions / r.sessions;
      return { r, rate, lift: rate / overallRate };
    });
  const best = scored.filter((x) => x.lift >= 1.5).sort((a, b) => b.lift - a.lift)[0];
  const worst = scored
    .filter((x) => x.lift <= 0.5)
    .sort((a, b) => a.lift - b.lift || b.r.sessions - a.r.sessions)[0];
  const pick = best ?? worst;
  if (!pick) return null;
  return {
    name: pick.r.name,
    lift: pick.lift,
    rate: pick.rate,
    overallRate,
    sessions: pick.r.sessions,
    direction: best ? 'up' : 'down',
  };
}

// ───────────────────────── DTOs ─────────────────────────

/** A metric with its previous-period value (null: compare off or nothing to compare). */
export interface MetricDto {
  value: number;
  previous: number | null;
}

export interface PeriodDto {
  days: number;
  firstDay: string;
  lastDay: string;
  previousFirstDay: string;
  previousLastDay: string;
}

export interface KpisDto {
  sessions: MetricDto;
  visitors: MetricDto;
  orders: MetricDto;
  revenueSoum: MetricDto;
  /** 0..1; value 0 with no sessions is shown as "—" (sessions.value = 0). */
  conversionRate: MetricDto;
  aovSoum: MetricDto;
  leads: MetricDto;
}

export interface DayPointDto {
  day: string;
  sessions: number;
  orders: number;
  revenueSoum: number;
}

export interface FunnelStepDto {
  step: FunnelStep;
  sessions: number;
}

export interface ChannelRowDto {
  channel: string;
  sessions: number;
  purchasingSessions: number;
  /** Model-attributed purchases (fractional under linear). */
  orders: number;
  revenueSoum: number;
}

export interface TopProductDto {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  units: number;
  revenueSoum: number;
  /** Sessions that viewed the product page. */
  views: number;
  /** Purchases containing the product / sessions that viewed it. */
  conversionRate: number | null;
}

export interface LatestOrderDto {
  number: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: string | null;
  carrier: string;
  totalSoum: number;
  customerName: string | null;
}

export type AttentionKind = 'sla_risk' | 'low_stock' | 'anomaly' | 'opportunity';

export type AttentionItemDto =
  | { kind: 'sla_risk'; severity: 'critical'; overdue: number; atRisk: number }
  | {
      kind: 'low_stock';
      severity: 'warning';
      count: number;
      items: { sku: string; name: string; label: string | null; available: number }[];
    }
  | {
      kind: 'anomaly';
      severity: 'warning';
      metric: 'bounce_rate';
      device: string;
      /** Percentage points (0.08 = +8 pp). */
      deltaPp: number;
      recentRate: number;
      baselineRate: number;
      recentDays: number;
    }
  | { kind: 'opportunity'; severity: 'good'; abandonedCarts: number; days: number };

export interface DashboardDto {
  period: PeriodDto;
  /** null = no `analytics.view` (CLAUDE.md §6). */
  activeNow: number | null;
  kpis: KpisDto | null;
  visits: DayPointDto[] | null;
  funnel: FunnelStepDto[] | null;
  channels: ChannelRowDto[] | null;
  topProducts: TopProductDto[] | null;
  /** null = no `orders.view`. */
  latestOrders: LatestOrderDto[] | null;
  attention: AttentionItemDto[];
}

export interface RealtimeDto {
  activeNow: number;
  /** Sessions with events per minute, oldest first (30 points). */
  perMinute: { minute: string; sessions: number }[];
  pages: { path: string; sessions: number }[];
  channels: { channel: string; sessions: number }[];
  regions: { region: string; sessions: number }[];
}

export interface SourceRowDto {
  source: string;
  medium: string;
  campaign: string | null;
  channel: string;
  platform: AdPlatform | null;
  sessions: number;
  bounceRate: number | null;
  avgDurationSec: number | null;
  leads: number;
  orders: number;
  revenueSoum: number;
  spendSoum: number | null;
  roas: number | null;
}

export interface SourceTotalsDto {
  sessions: number;
  leads: number;
  orders: number;
  revenueSoum: number;
  spendSoum: number;
  roas: number | null;
}

export interface SourcesDto {
  period: PeriodDto;
  model: AttributionModel;
  rows: SourceRowDto[];
  channels: ChannelRowDto[];
  totals: SourceTotalsDto;
  previousTotals: SourceTotalsDto | null;
  /** Purchases in the period whose attribution the job hasn't stored yet. */
  pendingOrders: number;
}

export interface PagesDto {
  period: PeriodDto;
  landing: { path: string; sessions: number; bounceRate: number | null }[];
  exit: { path: string; exits: number; pageviews: number; exitRate: number | null }[];
}

export interface EventRowDto extends GoalRow {
  count: number;
  rate: number | null;
  lift: number | null;
}

export interface EventsDto {
  period: PeriodDto;
  overall: { sessions: number; purchasingSessions: number; rate: number | null };
  events: EventRowDto[];
  insight: GoalInsight | null;
}

export interface FunnelDto {
  period: PeriodDto;
  steps: FunnelStepDto[];
  previous: FunnelStepDto[] | null;
  byDevice: { device: string; steps: FunnelStepDto[] }[];
  byChannel: { channel: string; steps: FunnelStepDto[] }[];
}

export interface DevicesDto {
  period: PeriodDto;
  devices: {
    device: string;
    sessions: number;
    share: number | null;
    purchasingSessions: number;
    conversionRate: number | null;
  }[];
  regions: { region: string; sessions: number; purchasingSessions: number }[];
}

/** Months after the first purchase month shown in the cohort table. */
export const COHORT_OFFSETS = 5;
export const COHORT_MONTHS = 6;

export interface CohortsDto {
  cohorts: {
    /** `YYYY-MM` (Tashkent) of the customers' first purchase. */
    month: string;
    customers: number;
    /** Share of the cohort buying again in month +1…+COHORT_OFFSETS; null = not reached yet. */
    retention: (number | null)[];
  }[];
}

// ── Ad spend ──

export interface AdSpendImportResultDto {
  rows: number;
  inserted: number;
  updated: number;
  firstDay: string | null;
  lastDay: string | null;
}

export interface AdSpendSummaryDto {
  period: PeriodDto;
  platforms: { platform: string; spendSoum: number; impressions: number; clicks: number }[];
  campaigns: {
    platform: string;
    campaignId: string;
    campaign: string;
    spendSoum: number;
    clicks: number;
    lastDay: string;
  }[];
  lastImportDay: string | null;
}

// ── Journeys (A5 / A7) ──

export interface TouchDto {
  at: string;
  kind: TouchKind;
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
}

export interface JourneySessionDto {
  id: string;
  startedAt: string;
  durationSec: number;
  pageviews: number;
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
  landingPath: string;
  device: string;
  region: string | null;
  viewedItems: number;
  addedToCart: number;
  beganCheckout: boolean;
  lead: boolean;
  orderNumber: string | null;
  hasReplay: boolean;
}

export interface CustomerJourneyDto {
  sessions: JourneySessionDto[];
  /** Only the latest sessions are listed. */
  truncated: boolean;
  summary: {
    sessions: number;
    firstTouch: TouchDto | null;
    lastTouch: TouchDto | null;
    channels: string[];
    /** First session → first purchase, in days (null: no purchase / no session before it). */
    visitToPurchaseDays: number | null;
    /** Allocated ad spend up to the first purchase (CLAUDE.md §6); null = no paid touch. */
    cacSoum: number | null;
  };
}

export interface OrderJourneyTouchDto extends TouchDto {
  sessionId: string | null;
  shares: AttributionShares;
  revenueSoum: Record<AttributionModel, number>;
}

export interface OrderJourneyDto {
  number: string;
  /** 'attributed' | 'pending' (a purchase the job hasn't processed) | 'not_purchase'. */
  state: 'attributed' | 'pending' | 'not_purchase';
  revenueSoum: number;
  computedAt: string | null;
  touches: OrderJourneyTouchDto[];
  purchaseSession: { id: string; hasReplay: boolean } | null;
}
