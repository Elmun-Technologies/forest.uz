import {
  CUSTOMER_SEGMENT_PRIORITY,
  CUSTOMER_SEGMENT_RULES,
  type CustomerFilters,
  type CustomerSegment,
  type CustomerSegmentTag,
  type CustomerSort,
  DomainError,
  soumToTiyin,
} from '@forest/contracts';
import { Prisma } from '@forest/db';

/**
 * Customer stats and segments in one SQL pass (CLAUDE.md §6 "Customer stats" / "segments").
 * `Customer.ordersCount/ltvTiyin` are not maintained, so everything is derived from orders,
 * payments, refunds, carts and visitors. Only filter values are parameters; enum literals and
 * rule constants are inlined.
 */

export interface StatsRow {
  id: string;
  publicId: string;
  name: string | null;
  phone: string | null;
  hasTelegram: boolean;
  tags: string[] | null;
  createdAt: Date;
  deletedAt: Date | null;
  purchases: number;
  ltv: bigint;
  ordersTotal: number;
  lastActivity: Date;
  region: string | null;
  firstSource: string | null;
  smsConsent: boolean | null;
  tgConsent: boolean | null;
  segNew: boolean;
  segLoyal: boolean;
  segAbandoned: boolean;
  segInactive: boolean;
  segLeads: boolean;
  sortKey: Prisma.Decimal;
}

const DAY_MS = 86_400_000;
const PURCHASE_PAYMENT = Prisma.sql`('PAID', 'PARTIALLY_REFUNDED')`;

/** `paid` (purchases with net amount) + `flagged` (one row per customer with stats and segments). */
function statsCte(now: Date, abandonedCartMinutes: number, where: Prisma.Sql): Prisma.Sql {
  const r = CUSTOMER_SEGMENT_RULES;
  const newSince = new Date(now.getTime() - r.newDays * DAY_MS);
  const inactiveBefore = new Date(now.getTime() - r.inactiveDays * DAY_MS);
  const abandonedFrom = new Date(now.getTime() - r.abandonedDays * DAY_MS);
  const abandonedTo = new Date(now.getTime() - abandonedCartMinutes * 60_000);
  const loyalLtv = soumToTiyin(r.loyalLtvSoum);
  return Prisma.sql`
    WITH paid AS (
      SELECT o."customerId" AS cid, o.id AS oid,
             SUM(p."amountTiyin") - COALESCE(SUM(rf.refunded), 0) AS net
      FROM "Order" o
      JOIN "Payment" p ON p."orderId" = o.id AND p.status IN ${PURCHASE_PAYMENT}
      LEFT JOIN LATERAL (
        SELECT SUM(r."amountTiyin") AS refunded FROM "Refund" r WHERE r."paymentId" = p.id
      ) rf ON true
      GROUP BY o."customerId", o.id
    ),
    pstats AS (
      SELECT cid, COUNT(*)::int AS purchases, SUM(net)::bigint AS ltv FROM paid GROUP BY cid
    ),
    ostats AS (
      SELECT "customerId" AS cid, COUNT(*)::int AS orders_total, MAX("createdAt") AS last_order
      FROM "Order" GROUP BY "customerId"
    ),
    base AS (
      SELECT c.id, c."publicId", c.name, c.phone, c."telegramId" IS NOT NULL AS "hasTelegram",
        c.tags, c."createdAt", c."deletedAt",
        COALESCE(ps.purchases, 0) AS purchases,
        COALESCE(ps.ltv, 0)::bigint AS ltv,
        COALESCE(os.orders_total, 0) AS "ordersTotal",
        GREATEST(
          c."createdAt", c."leadAt", os.last_order,
          (SELECT MAX(k."updatedAt") FROM "Cart" k WHERE k."customerId" = c.id),
          (SELECT MAX(v."lastSeenAt") FROM "Visitor" v WHERE v."customerId" = c.id)
        ) AS "lastActivity",
        COALESCE(
          (SELECT a.region FROM "Address" a WHERE a."customerId" = c.id
            ORDER BY a."isDefault" DESC, a.id ASC LIMIT 1),
          (SELECT o.address->>'region' FROM "Order" o WHERE o."customerId" = c.id
            ORDER BY o."createdAt" DESC LIMIT 1)
        ) AS region,
        COALESCE(NULLIF(c."firstTouch"->>'source', ''), c."leadSource") AS "firstSource",
        (SELECT cs.granted FROM "Consent" cs WHERE cs."customerId" = c.id
          AND cs.channel = 'SMS_MARKETING' ORDER BY cs."createdAt" DESC, cs.id DESC LIMIT 1
        ) AS "smsConsent",
        (SELECT cs.granted FROM "Consent" cs WHERE cs."customerId" = c.id
          AND cs.channel = 'TELEGRAM' ORDER BY cs."createdAt" DESC, cs.id DESC LIMIT 1
        ) AS "tgConsent",
        EXISTS (
          SELECT 1 FROM "Cart" k
          WHERE k."customerId" = c.id AND k.status IN ('ACTIVE', 'ABANDONED_NOTIFIED')
            AND k."updatedAt" >= ${abandonedFrom} AND k."updatedAt" <= ${abandonedTo}
            AND EXISTS (SELECT 1 FROM "CartItem" i WHERE i."cartId" = k.id)
            AND NOT EXISTS (
              SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o."createdAt" >= k."updatedAt"
            )
        ) AS "segAbandoned"
      FROM "Customer" c
      LEFT JOIN pstats ps ON ps.cid = c.id
      LEFT JOIN ostats os ON os.cid = c.id
      WHERE ${where}
    ),
    flagged AS (
      SELECT b.*,
        b."createdAt" >= ${newSince} AS "segNew",
        (b.purchases >= ${r.loyalPurchases} OR b.ltv >= ${loyalLtv}) AS "segLoyal",
        b."lastActivity" < ${inactiveBefore} AS "segInactive",
        b.purchases = 0 AS "segLeads"
      FROM base b
    )`;
}

function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Search: name, phone digits, order number (F-10482 / 10482), customer id (C-10001). */
function searchSql(q: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`f.name ILIKE ${`%${likeEscape(q)}%`}`];
  const publicId = /^c-?(\d{3,})$/i.exec(q);
  if (publicId) parts.push(Prisma.sql`f."publicId" = ${`C-${publicId[1]}`}`);
  const order = /^(?:f-?)?(\d{4,})$/i.exec(q);
  if (order)
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = f.id AND o.number = ${`F-${order[1]}`})`,
    );
  const digits = q.replace(/[\s()+-]/g, '');
  if (/^\d{3,15}$/.test(digits)) parts.push(Prisma.sql`f.phone LIKE ${`%${digits}%`}`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function filterSql(f: CustomerFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`true`];
  if (f.region) parts.push(Prisma.sql`f.region = ${f.region}`);
  if (f.source) parts.push(Prisma.sql`f."firstSource" = ${f.source}`);
  if (f.ltvMin !== undefined) parts.push(Prisma.sql`f.ltv >= ${soumToTiyin(f.ltvMin)}`);
  if (f.ltvMax !== undefined) parts.push(Prisma.sql`f.ltv <= ${soumToTiyin(f.ltvMax)}`);
  if (f.productId)
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM paid pd
      JOIN "OrderItem" oi ON oi."orderId" = pd.oid
      JOIN "Variant" v ON v.id = oi."variantId"
      WHERE pd.cid = f.id AND v."productId" = ${f.productId})`);
  if (f.q) parts.push(searchSql(f.q));
  return Prisma.join(parts, ' AND ');
}

const SEGMENT_COLUMN: Record<CustomerSegmentTag, Prisma.Sql> = {
  new: Prisma.sql`f."segNew"`,
  loyal: Prisma.sql`f."segLoyal"`,
  abandoned: Prisma.sql`f."segAbandoned"`,
  inactive: Prisma.sql`f."segInactive"`,
  leads: Prisma.sql`f."segLeads"`,
};

function segmentSql(segment: CustomerSegment): Prisma.Sql {
  return segment === 'all' ? Prisma.sql`true` : SEGMENT_COLUMN[segment];
}

const SORT_KEY: Record<CustomerSort, Prisma.Sql> = {
  activity: Prisma.sql`(EXTRACT(EPOCH FROM f."lastActivity") * 1000)::numeric`,
  ltv: Prisma.sql`f.ltv::numeric`,
  orders: Prisma.sql`f.purchases::numeric`,
  created: Prisma.sql`(EXTRACT(EPOCH FROM f."createdAt") * 1000)::numeric`,
};

export function encodeCursor(sortKey: Prisma.Decimal, id: string): string {
  return Buffer.from(`${sortKey.toString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { key: string; id: string } {
  const [key, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!key || !id || !/^-?\d+(\.\d+)?$/.test(key))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { key, id };
}

export interface ListSqlInput {
  now: Date;
  abandonedCartMinutes: number;
  filters: CustomerFilters;
  sort: CustomerSort;
  cursor?: string;
  limit: number;
}

const LIVE = Prisma.sql`c."deletedAt" IS NULL`;

/** One page of customers (limit + 1 rows, so the caller knows whether more exist). */
export function listSql(input: ListSqlInput): Prisma.Sql {
  const key = SORT_KEY[input.sort];
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const keyset = cursor
    ? Prisma.sql`(${key}, f.id) < (${cursor.key}::numeric, ${cursor.id})`
    : Prisma.sql`true`;
  return Prisma.sql`${statsCte(input.now, input.abandonedCartMinutes, LIVE)}
    SELECT f.*, ${key} AS "sortKey" FROM flagged f
    WHERE ${filterSql(input.filters)} AND ${segmentSql(input.filters.segment)} AND ${keyset}
    ORDER BY ${key} DESC, f.id DESC
    LIMIT ${input.limit + 1}`;
}

export interface CountsRow {
  all: number;
  new: number;
  loyal: number;
  abandoned: number;
  inactive: number;
  leads: number;
}

/** Chip counts: every segment with the other filters applied. */
export function countsSql(now: Date, abandonedCartMinutes: number, filters: CustomerFilters) {
  return Prisma.sql`${statsCte(now, abandonedCartMinutes, LIVE)}
    SELECT COUNT(*)::int AS "all",
      (COUNT(*) FILTER (WHERE f."segNew"))::int AS "new",
      (COUNT(*) FILTER (WHERE f."segLoyal"))::int AS "loyal",
      (COUNT(*) FILTER (WHERE f."segAbandoned"))::int AS "abandoned",
      (COUNT(*) FILTER (WHERE f."segInactive"))::int AS "inactive",
      (COUNT(*) FILTER (WHERE f."segLeads"))::int AS "leads"
    FROM flagged f WHERE ${filterSql(filters)}`;
}

/** All matching rows for the CSV export (capped by the caller's `max`). */
export function exportSql(
  now: Date,
  abandonedCartMinutes: number,
  f: CustomerFilters,
  max: number,
) {
  return Prisma.sql`${statsCte(now, abandonedCartMinutes, LIVE)}
    SELECT f.*, ${SORT_KEY.activity} AS "sortKey" FROM flagged f
    WHERE ${filterSql(f)} AND ${segmentSql(f.segment)}
    ORDER BY ${SORT_KEY.activity} DESC, f.id DESC
    LIMIT ${max + 1}`;
}

/** Stats of one customer, erased or not (A5). */
export function oneSql(now: Date, abandonedCartMinutes: number, id: string): Prisma.Sql {
  return Prisma.sql`${statsCte(now, abandonedCartMinutes, Prisma.sql`c.id = ${id}`)}
    SELECT f.*, 0::numeric AS "sortKey" FROM flagged f`;
}

export function segmentsOf(row: StatsRow): CustomerSegmentTag[] {
  const has: Record<CustomerSegmentTag, boolean> = {
    new: row.segNew,
    loyal: row.segLoyal,
    abandoned: row.segAbandoned,
    inactive: row.segInactive,
    leads: row.segLeads,
  };
  return CUSTOMER_SEGMENT_PRIORITY.filter((s) => has[s]);
}
