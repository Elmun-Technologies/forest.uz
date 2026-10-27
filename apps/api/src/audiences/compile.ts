import {
  AUDIENCE_LIMITS,
  type AudienceCondition,
  type AudienceConsent,
  type AudiencePathMatch,
  type AudienceRules,
  soumToTiyin,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { isPurchase, revenueOf } from '../admin/analytics/sql';

/**
 * Audience rule tree → ONE parameterised SQL query returning the member customer ids
 * (CLAUDE.md §6 "Audiences"). The size preview and the hourly refresh both wrap this query, so
 * the preview always equals what the refresh stores. Every value is a bound parameter; the only
 * raw SQL is code constants (table/column names, enum casts), never rule input.
 *
 * Alias `c` = the candidate "Customer" row.
 */

const DAY_MS = 86_400_000;

const CONSENT_CHANNEL: Record<AudienceConsent, string> = {
  sms: 'SMS_MARKETING',
  telegram: 'TELEGRAM',
  ads: 'ADS_MATCHING',
};

/** Latest consent row of `c` for a channel (append-only log, CLAUDE.md §6), false when none. */
export function consentGranted(channel: AudienceConsent, c = Prisma.raw('c')): Prisma.Sql {
  return Prisma.sql`COALESCE((
    SELECT cs.granted FROM "Consent" cs
    WHERE cs."customerId" = ${c}.id AND cs.channel = ${CONSENT_CHANNEL[channel]}::"ConsentChannel"
    ORDER BY cs."createdAt" DESC, cs.id DESC LIMIT 1), false)`;
}

/** Events of the customer: stamped with it, or of a visitor linked to it (identity stitching). */
const EVENT_OWNER = Prisma.sql`(e."customerId" = c.id OR e."anonymousId" IN (
  SELECT v."anonymousId" FROM "Visitor" v WHERE v."customerId" = c.id))`;

const SESSION_OWNER = Prisma.sql`(s."customerId" = c.id OR s."anonymousId" IN (
  SELECT v."anonymousId" FROM "Visitor" v WHERE v."customerId" = c.id))`;

const LOCALES = ['/uz', '/ru'];

function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Storefront paths carry a locale prefix; a rule path matches with or without it. */
export function pathSql(column: Prisma.Sql, m: AudiencePathMatch): Prisma.Sql {
  const value = m.value || '/';
  if (m.op === 'equals') {
    const values =
      value === '/'
        ? ['/', ...LOCALES, ...LOCALES.map((l) => `${l}/`)]
        : [value, ...LOCALES.map((l) => `${l}${value}`)];
    return Prisma.sql`${column} IN (${Prisma.join(values)})`;
  }
  const patterns = [value, ...LOCALES.map((l) => `${l}${value === '/' ? '' : value}`)].map(
    (p) => `${likeEscape(p)}%`,
  );
  return Prisma.sql`(${Prisma.join(
    patterns.map((p) => Prisma.sql`${column} LIKE ${p}`),
    ' OR ',
  )})`;
}

/** Purchases of `c` (analytics purchase predicate), optional extra filter on `o`. */
function purchases(extra: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`"Order" o WHERE o."customerId" = c.id AND ${isPurchase('o')} ${extra}`;
}

const not = (did: boolean, sql: Prisma.Sql) => (did ? sql : Prisma.sql`NOT ${sql}`);

function since(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Region like A4: default address, else the latest order's region. */
const REGION = Prisma.sql`COALESCE(
  (SELECT a.region FROM "Address" a WHERE a."customerId" = c.id ORDER BY a."isDefault" DESC, a.id ASC LIMIT 1),
  (SELECT o.address->>'region' FROM "Order" o WHERE o."customerId" = c.id ORDER BY o."createdAt" DESC LIMIT 1))`;

export function conditionSql(cond: AudienceCondition, now: Date): Prisma.Sql {
  switch (cond.type) {
    case 'event': {
      const from = since(now, cond.withinDays);
      if (cond.event === 'purchase') {
        // Orders are the truth for purchases (orders before Phase 4 have no events).
        return not(
          cond.did,
          Prisma.sql`EXISTS (SELECT 1 FROM ${purchases(Prisma.sql`AND o."createdAt" >= ${from}`)})`,
        );
      }
      const path = cond.path
        ? Prisma.sql`AND ${pathSql(Prisma.sql`e.path`, cond.path)}`
        : Prisma.empty;
      return not(
        cond.did,
        Prisma.sql`EXISTS (SELECT 1 FROM "Event" e
          WHERE e.name = ${cond.event} AND e.ts >= ${from} AND e.ts <= ${now}
            AND ${EVENT_OWNER} ${path})`,
      );
    }
    case 'page_time': {
      const from = since(now, cond.withinDays);
      const cap = AUDIENCE_LIMITS.pageViewCapSeconds;
      // A page_view lasts until the next page_view of its session, else the session's last
      // event (Session.endedAt); capped so an open tab is not attention.
      const seconds = Prisma.sql`COALESCE((
        SELECT SUM(LEAST(GREATEST(EXTRACT(EPOCH FROM (COALESCE(pv.next_ts, s."endedAt") - pv.ts)), 0), ${cap}))
        FROM (
          SELECT e."sessionId", e.path, e.ts,
                 LEAD(e.ts) OVER (PARTITION BY e."sessionId" ORDER BY e.ts) AS next_ts
          FROM "Event" e
          WHERE e.name = 'page_view' AND e.ts >= ${from} AND e.ts <= ${now} AND ${EVENT_OWNER}
        ) pv
        LEFT JOIN "Session" s ON s.id = pv."sessionId"
        WHERE ${pathSql(Prisma.sql`pv.path`, cond.path)}), 0)`;
      return cond.did
        ? Prisma.sql`${seconds} >= ${cond.minSeconds}`
        : Prisma.sql`${seconds} < ${cond.minSeconds}`;
    }
    case 'orders': {
      const window = cond.withinDays
        ? Prisma.sql`AND o."createdAt" >= ${since(now, cond.withinDays)}`
        : Prisma.empty;
      const metric =
        cond.metric === 'count'
          ? Prisma.sql`(SELECT COUNT(*) FROM ${purchases(window)})`
          : Prisma.sql`COALESCE((SELECT SUM(${revenueOf('o')}) FROM ${purchases(window)}), 0)`;
      const value = cond.metric === 'count' ? cond.value : soumToTiyin(cond.value);
      return cond.op === 'gte'
        ? Prisma.sql`${metric} >= ${value}`
        : Prisma.sql`${metric} <= ${value}`;
    }
    case 'last_order': {
      const last = Prisma.sql`(SELECT MAX(o."createdAt") FROM ${purchases()})`;
      const edge = since(now, cond.days);
      return cond.op === 'within' ? Prisma.sql`${last} >= ${edge}` : Prisma.sql`${last} < ${edge}`;
    }
    case 'product': {
      const parts: Prisma.Sql[] = [];
      if (cond.withinDays)
        parts.push(Prisma.sql`AND o."createdAt" >= ${since(now, cond.withinDays)}`);
      if (cond.bought && cond.olderThanDays)
        parts.push(Prisma.sql`AND o."createdAt" <= ${since(now, cond.olderThanDays)}`);
      const bought = Prisma.sql`EXISTS (
        SELECT 1 FROM ${purchases(parts.length ? Prisma.join(parts, ' ') : Prisma.empty)}
          AND EXISTS (SELECT 1 FROM "OrderItem" oi JOIN "Variant" pv ON pv.id = oi."variantId"
                      WHERE oi."orderId" = o.id AND pv."productId" = ${cond.productId}))`;
      return not(cond.bought, bought);
    }
    case 'consent':
      return Prisma.sql`${consentGranted(cond.channel)} = ${cond.granted}`;
    case 'tag':
      return not(cond.has, Prisma.sql`(${cond.tag} = ANY(COALESCE(c.tags, ARRAY[]::text[])))`);
    case 'region': {
      const inList = Prisma.sql`COALESCE(${REGION} IN (${Prisma.join(cond.regions)}), false)`;
      return not(cond.include, inList);
    }
    case 'device':
      return Prisma.sql`(SELECT s.device FROM "Session" s WHERE ${SESSION_OWNER}
        ORDER BY s."startedAt" DESC LIMIT 1) = ${cond.device}`;
    case 'lead': {
      const lead = cond.source
        ? Prisma.sql`(c."leadAt" IS NOT NULL AND c."leadSource" = ${cond.source})`
        : Prisma.sql`(c."leadAt" IS NOT NULL)`;
      return not(cond.has, lead);
    }
  }
}

/** `SELECT c.id FROM "Customer" c WHERE …` — live customers matching any group. */
export function compileAudience(rules: AudienceRules, now: Date): Prisma.Sql {
  const groups = rules.groups.map(
    (g) =>
      Prisma.sql`(${Prisma.join(
        g.conditions.map((cond) => Prisma.sql`(${conditionSql(cond, now)})`),
        ' AND ',
      )})`,
  );
  return Prisma.sql`SELECT c.id FROM "Customer" c
    WHERE c."deletedAt" IS NULL AND (${Prisma.join(groups, ' OR ')})`;
}

/** Live size of an audience: total, reachable by phone / Telegram, uploadable to ad platforms. */
export function previewSql(rules: AudienceRules, now: Date): Prisma.Sql {
  return Prisma.sql`WITH m AS (${compileAudience(rules, now)})
    SELECT COUNT(*)::int AS total,
           COUNT(c.phone)::int AS "withPhone",
           COUNT(c."telegramId")::int AS "withTelegram",
           (COUNT(*) FILTER (WHERE c.phone IS NOT NULL AND ${consentGranted('ads')}))::int AS "adsReady"
    FROM m JOIN "Customer" c ON c.id = m.id`;
}
