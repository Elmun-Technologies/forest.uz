import { scrubPath, type TrackPropsMap } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { createHash } from 'node:crypto';

/**
 * Server-side analytics events (docs/07): `purchase` (on PAID or COD CONFIRMED) and `lead`.
 * Plain functions over a transaction client, so the order lifecycle can write the purchase in
 * the same transaction that confirms the order without depending on the tracking module.
 */
type Tx = Prisma.TransactionClient;

/** RFC 4122 name-based UUID (v5 layout, SHA-1) under a fixed Forest namespace. */
export function deterministicUuid(name: string): string {
  const h = createHash('sha1').update(`forest:analytics:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Event id of an order's purchase — also the `event_id` for ad-platform dedupe (CAPI). */
export const purchaseEventId = (orderId: string) => deterministicUuid(`purchase:${orderId}`);

/** One lead event per customer, source and Tashkent day. */
export const leadEventId = (customerId: string, source: string, day: string) =>
  deterministicUuid(`lead:${customerId}:${source}:${day}`);

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The tracker's session cookie value when it is a well-formed id. */
export function trackerSessionId(raw: unknown): string | null {
  return typeof raw === 'string' && SESSION_ID.test(raw.toLowerCase()) ? raw.toLowerCase() : null;
}

/** Path of the page a request came from (Referer), scrubbed like tracker paths; null if none. */
export function refererPath(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return scrubPath(new URL(referer).pathname);
  } catch {
    return null;
  }
}

interface ServerEvent {
  id: string;
  ts: Date;
  name: 'purchase' | 'lead';
  sessionId: string;
  anonymousId: string;
  customerId: string | null;
  path: string;
  props: Record<string, unknown>;
  /** Earliest time an earlier copy of this id can have: bounds the lookup (partition pruning). */
  since: Date;
}

/** Inserts unless an event with this id already exists since `since`: idempotent by id. */
async function insertOnce(tx: Tx, e: ServerEvent): Promise<boolean> {
  const n = await tx.$executeRaw`
    INSERT INTO "Event" ("id", "ts", "sessionId", "anonymousId", "customerId", "name", "path", "props")
    SELECT ${e.id}, ${e.ts}, ${e.sessionId}, ${e.anonymousId}, ${e.customerId}, ${e.name}, ${e.path},
           ${JSON.stringify(e.props)}::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM "Event"
      WHERE "id" = ${e.id} AND "name" = ${e.name} AND "ts" >= ${e.since})`;
  return n > 0;
}

/**
 * The tracker session id from `fr_sid` only when it can belong to this visitor: a stored session
 * of another visitor is refused (a crafted cookie must not mark someone else's session). A
 * session not stored yet (its first beacon is still in flight) is accepted; marking it converted
 * later checks the visitor again.
 */
export async function verifiedSessionId(
  db: Tx,
  raw: string | null,
  anonymousId: string | null,
): Promise<string | null> {
  const sid = trackerSessionId(raw);
  if (!sid || !anonymousId) return null;
  const row = await db.session.findUnique({ where: { id: sid }, select: { anonymousId: true } });
  return !row || row.anonymousId === anonymousId ? sid : null;
}

/**
 * `purchase` for an order that just became CONFIRMED (paid online, or COD confirmed by the
 * operator). Runs inside that transaction; the deterministic id keeps it once per order. Session
 * and visitor are the ones checkout recorded (empty string = none, e.g. phone orders); the
 * session is marked converted.
 */
export async function recordPurchaseEvent(tx: Tx, orderId: string, at: Date): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      customerId: true,
      totalTiyin: true,
      paymentMethod: true,
      anonymousId: true,
      sessionId: true,
      createdAt: true,
      items: { select: { variantId: true, sku: true, qty: true, priceTiyin: true } },
    },
  });
  const props: TrackPropsMap['purchase'] = {
    orderNumber: order.number,
    valueTiyin: order.totalTiyin.toString(),
    currency: 'UZS',
    paymentMethod: order.paymentMethod,
    items: order.items.map((i) => ({
      variantId: i.variantId,
      sku: i.sku,
      qty: i.qty,
      priceTiyin: i.priceTiyin.toString(),
    })),
  };
  const inserted = await insertOnce(tx, {
    id: purchaseEventId(order.id),
    ts: at,
    name: 'purchase',
    sessionId: order.sessionId ?? '',
    anonymousId: order.anonymousId ?? '',
    customerId: order.customerId,
    path: '/checkout',
    props,
    since: order.createdAt,
  });
  if (inserted && order.sessionId && order.anonymousId)
    await tx.session.updateMany({
      where: { id: order.sessionId, anonymousId: order.anonymousId },
      data: { converted: true, orderId: order.id },
    });
}

/** `lead` after a lead was stored (popup, selector, footer…). */
export async function recordLeadEvent(
  tx: Tx,
  input: {
    customerId: string;
    source: string;
    anonymousId: string | null;
    sessionId: string | null;
    /** Page the lead came from (scrubbed Referer), else `/`. */
    path: string | null;
    at: Date;
    day: string;
  },
): Promise<void> {
  const props: TrackPropsMap['lead'] = { source: input.source };
  await insertOnce(tx, {
    id: leadEventId(input.customerId, input.source, input.day),
    ts: input.at,
    name: 'lead',
    sessionId: input.sessionId ?? '',
    anonymousId: input.anonymousId ?? '',
    customerId: input.customerId,
    path: input.path ?? '/',
    props,
    // One id per Tashkent day: an earlier copy is at most a day old.
    since: new Date(input.at.getTime() - 86_400_000),
  });
}
