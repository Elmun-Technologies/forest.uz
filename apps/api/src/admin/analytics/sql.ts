import { AD_PLATFORM_SOURCES, AD_PLATFORMS, type AnalyticsDevice } from '@forest/contracts';
import { Prisma } from '@forest/db';

/**
 * SQL building blocks shared by the A1/A2 reports, journeys and the attribution job, so every
 * number uses one definition (CLAUDE.md §6 "Analytics purchase"). Aliases are code constants,
 * never user input; values are always parameters.
 */

const alias = (a: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(a)) throw new Error(`bad SQL alias ${a}`);
  return Prisma.raw(a);
};

/** COD orders the operator confirmed count as purchases (docs/07 `purchase`). */
const COD_PURCHASE_STATUSES = Prisma.raw(
  `('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED')`,
);

/** True when order `o` is a purchase. */
export function isPurchase(o = 'o'): Prisma.Sql {
  const a = alias(o);
  return Prisma.sql`(${a}.status NOT IN ('CANCELLED', 'RETURNED') AND (
    EXISTS (SELECT 1 FROM "Payment" pp WHERE pp."orderId" = ${a}.id
            AND pp.status IN ('PAID', 'PARTIALLY_REFUNDED'))
    OR (${a}."paymentMethod" = 'COD' AND ${a}.status IN ${COD_PURCHASE_STATUSES})
  ))`;
}

/** Purchase revenue of order `o` in tiyin: total minus refunds of its payments. */
export function revenueOf(o = 'o'): Prisma.Sql {
  const a = alias(o);
  return Prisma.sql`(${a}."totalTiyin" - COALESCE((
    SELECT SUM(rf."amountTiyin") FROM "Refund" rf JOIN "Payment" rp ON rp.id = rf."paymentId"
    WHERE rp."orderId" = ${a}.id), 0))`;
}

/** Tashkent calendar day of a timestamptz column. */
export function tashkentDay(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${column} AT TIME ZONE 'Asia/Tashkent')::date`;
}

/**
 * Traffic key of session `s`: utm source/medium/campaign, else derived from the referrer host and
 * the channel class (`(direct) / (none)`, `google / organic`…). Lower-cased so spellings merge.
 */
export function sessionSource(s = 's'): Prisma.Sql {
  const a = alias(s);
  return Prisma.sql`COALESCE(
    NULLIF(lower(btrim(${a}.utm->>'source')), ''),
    CASE WHEN ${a}.channel = 'direct' THEN '(direct)' ELSE COALESCE(
      NULLIF(lower(substring(${a}.referrer FROM '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?:www[.])?([^/:?#]+)')), ''),
      ${a}.channel) END)`;
}

export function sessionMedium(s = 's'): Prisma.Sql {
  const a = alias(s);
  return Prisma.sql`COALESCE(
    NULLIF(lower(btrim(${a}.utm->>'medium')), ''),
    CASE ${a}.channel
      WHEN 'direct' THEN '(none)'
      WHEN 'organic_search' THEN 'organic'
      WHEN 'organic_social' THEN 'social'
      ELSE ${a}.channel END)`;
}

export function sessionCampaign(s = 's'): Prisma.Sql {
  const a = alias(s);
  return Prisma.sql`NULLIF(btrim(${a}.utm->>'campaign'), '')`;
}

/** Ad platform (meta/google/tiktok/yandex) of a lower-case source expression, else NULL. */
export function platformOf(source: Prisma.Sql): Prisma.Sql {
  const whens = AD_PLATFORMS.map(
    (p) =>
      Prisma.sql`WHEN ${source} IN (${Prisma.join(AD_PLATFORM_SOURCES[p] as readonly string[])}) THEN ${p}`,
  );
  return Prisma.sql`(CASE ${Prisma.join(whens, ' ')} ELSE NULL END)`;
}

export interface SessionFilters {
  device?: AnalyticsDevice;
  channel?: string;
}

/** Extra AND conditions on session `s` for the A2 device / channel filters. */
export function sessionFilter(f: SessionFilters, s = 's'): Prisma.Sql {
  const a = alias(s);
  const parts: Prisma.Sql[] = [];
  if (f.device) parts.push(Prisma.sql`${a}.device = ${f.device}`);
  if (f.channel) parts.push(Prisma.sql`${a}.channel = ${f.channel}`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

/**
 * Purchases filtered like sessions: with a device/channel filter only purchases whose own
 * session (`Order.sessionId`) matches are counted.
 */
export function purchaseSessionFilter(f: SessionFilters, o = 'o'): Prisma.Sql {
  if (!f.device && !f.channel) return Prisma.empty;
  const a = alias(o);
  return Prisma.sql`AND EXISTS (SELECT 1 FROM "Session" fs WHERE fs.id = ${a}."sessionId" ${sessionFilter(f, 'fs')})`;
}

/** Clock slack around a session's own span (client clocks are corrected, not exact). */
const SESSION_EVENT_SLACK = Prisma.raw(`interval '1 minute'`);
/** Pruning bound past the period end for sessions still running at midnight. */
const SESSION_RUNOVER_MS = 86_400_000;

/**
 * Event `e` belongs to session `s` (one of the period's sessions) and lies within that session's
 * own span, ± 1 minute. Session reports (funnel, goals, leads, exit page views) count a session's
 * events even after the period end — a session started at 23:50 that checks out at 00:10 is one
 * funnel journey. The outer `ts` bounds only keep partition pruning (sessions are selected by
 * start time in [from, to)).
 */
export function eventInSession(r: { from: Date; to: Date }, e = 'e', s = 'ss'): Prisma.Sql {
  const ea = alias(e);
  const sa = alias(s);
  return Prisma.sql`${ea}."sessionId" = ${sa}.id
    AND ${ea}.ts >= ${new Date(r.from.getTime() - 60_000)}
    AND ${ea}.ts < ${new Date(r.to.getTime() + SESSION_RUNOVER_MS)}
    AND ${ea}.ts >= ${sa}."startedAt" - ${SESSION_EVENT_SLACK}
    AND ${ea}.ts <= ${sa}."endedAt" + ${SESSION_EVENT_SLACK}`;
}

/** True when session `s` led to a purchase (its id is a purchase's `Order.sessionId`). */
export function sessionPurchased(s = 's'): Prisma.Sql {
  const a = alias(s);
  return Prisma.sql`EXISTS (SELECT 1 FROM "Order" po WHERE po."sessionId" = ${a}.id AND ${isPurchase('po')})`;
}

/** Postgres numeric/bigint/decimal results → JS number. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(String(v));
}

/** Tiyin (numeric) → whole so'm, rounded half up. */
export function soum(tiyin: unknown): number {
  return Math.round(num(tiyin) / 100);
}
