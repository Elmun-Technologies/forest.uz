/**
 * Attribution models (docs/07 "Attribution", CLAUDE.md §6). Pure and zod-free: the API job that
 * stores `Order.attribution`, the A2 reports (via the stored shares) and the A7 model switch all
 * use these functions.
 */

export const ATTRIBUTION_MODELS = ['first_touch', 'last_non_direct', 'linear'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
export const DEFAULT_ATTRIBUTION_MODEL: AttributionModel = 'last_non_direct';

/** Touches older than this before the order don't count (also cut at the previous purchase). */
export const ATTRIBUTION_LOOKBACK_DAYS = 90;
/** Longest journey kept per order (the latest touches). */
export const ATTRIBUTION_MAX_TOUCHES = 100;
/** Stored shape version: bump to make the job recompute older rows. */
export const ATTRIBUTION_VERSION = 1;

/** session = a site visit; bot = a Telegram bot conversation; message = a marketing SMS/TG send. */
export type TouchKind = 'session' | 'bot' | 'message' | 'order';

export interface AttributionTouch {
  at: string;
  kind: TouchKind;
  /** Channel class (session channel, `bot`, `sms`, `phone`, `direct`…). */
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
  sessionId: string | null;
}

export type AttributionShares = Record<AttributionModel, number>;

export interface StoredTouch extends AttributionTouch {
  shares: AttributionShares;
}

/** `Order.attribution` JSON. */
export interface OrderAttribution {
  v: number;
  computedAt: string;
  touches: StoredTouch[];
}

export function isAttributionModel(value: unknown): value is AttributionModel {
  return typeof value === 'string' && (ATTRIBUTION_MODELS as readonly string[]).includes(value);
}

export const isDirectChannel = (channel: string) => channel === 'direct';

/**
 * Credit (0..1, summing to 1) each touch gets under `model`; touches in time order.
 * - first_touch: all to the first touch
 * - last_non_direct: all to the last touch whose channel isn't `direct`, else to the last touch
 * - linear: equal parts
 */
export function attributionShares(
  touches: readonly { channel: string }[],
  model: AttributionModel,
): number[] {
  const n = touches.length;
  const shares = new Array<number>(n).fill(0);
  if (n === 0) return shares;
  if (model === 'linear') return shares.fill(1 / n);
  if (model === 'first_touch') {
    shares[0] = 1;
    return shares;
  }
  let pick = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (!isDirectChannel(touches[i]!.channel)) {
      pick = i;
      break;
    }
  }
  shares[pick] = 1;
  return shares;
}

/**
 * Orders touches by time (stable), keeps the latest `ATTRIBUTION_MAX_TOUCHES` and stores every
 * model's share on each touch. An empty journey stays empty (callers add the order's own touch).
 */
export function attributeTouches(
  touches: readonly AttributionTouch[],
  computedAt: Date,
): OrderAttribution {
  const sorted = touches
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Date.parse(a.t.at) - Date.parse(b.t.at) || a.i - b.i)
    .map((x) => x.t)
    .slice(-ATTRIBUTION_MAX_TOUCHES);
  const byModel = Object.fromEntries(
    ATTRIBUTION_MODELS.map((m) => [m, attributionShares(sorted, m)]),
  ) as Record<AttributionModel, number[]>;
  return {
    v: ATTRIBUTION_VERSION,
    computedAt: computedAt.toISOString(),
    touches: sorted.map((t, i) => ({
      ...t,
      shares: {
        first_touch: byModel.first_touch[i]!,
        last_non_direct: byModel.last_non_direct[i]!,
        linear: byModel.linear[i]!,
      },
    })),
  };
}

/**
 * Splits an integer amount (tiyin) by shares without losing a unit (largest remainder): the parts
 * always add up to `total`.
 */
export function allocateByShares(total: bigint, shares: readonly number[]): bigint[] {
  if (shares.length === 0) return [];
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares.map(() => 0n);
  const SCALE = 1_000_000_000n;
  const weights = shares.map((s) => BigInt(Math.round((s / sum) * Number(SCALE))));
  const wsum = weights.reduce((a, b) => a + b, 0n);
  const parts = weights.map((w) => (total * w) / wsum);
  let rest = total - parts.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % wsum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (let k = 0; rest > 0n; k = (k + 1) % order.length, rest--) parts[order[k]!.i]! += 1n;
  return parts;
}

/** Reads a stored `Order.attribution` defensively (older/foreign shapes → null). */
export function parseOrderAttribution(value: unknown): OrderAttribution | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<OrderAttribution>;
  if (typeof v.v !== 'number' || typeof v.computedAt !== 'string' || !Array.isArray(v.touches))
    return null;
  const ok = v.touches.every(
    (t) =>
      t &&
      typeof t === 'object' &&
      typeof t.channel === 'string' &&
      typeof t.at === 'string' &&
      t.shares &&
      ATTRIBUTION_MODELS.every((m) => typeof t.shares[m] === 'number'),
  );
  return ok ? (v as OrderAttribution) : null;
}
