/**
 * Outbound webhooks + partner API keys (docs/05, A10, CLAUDE.md §6). Zod-free: the admin UI
 * imports these from `@forest/contracts/core`; inputs live in `schemas/automation.ts`.
 */

/** Events an endpoint can subscribe to (payloads: `WebhookPayloadMap`). */
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.status_changed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'customer.created',
  'review.approved',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** The event a "send test" delivery carries (never collected from real data). */
export const WEBHOOK_TEST_EVENT = 'webhook.test' as const;

export const WEBHOOK_POLICY = {
  /** docs/05: 8 attempts with exponential backoff. */
  maxAttempts: 8,
  /** Wait after failed attempt n (1-based) before attempt n + 1. */
  backoffSec: [30, 120, 600, 1800, 3600, 10_800, 21_600] as readonly number[],
  /** FAILED deliveries in a row that switch an endpoint off (≈ 11 h of outage). */
  autoDisableAfter: 5,
  timeoutMs: 10_000,
  /** Receivers reject signatures older/newer than this (replay window). */
  toleranceSec: 300,
  maxEndpoints: 20,
  /** Collector lookback behind its cursor: late commits are still picked up (dedup by key). */
  lookbackSec: 120,
  /** Sender lease on a claimed delivery. */
  leaseSec: 120,
  batch: 25,
} as const;

/**
 * Seconds until the next attempt after `attempts` failed attempts, or null when the delivery is
 * dead (all `maxAttempts` used).
 */
export function webhookRetryDelaySec(attempts: number): number | null {
  if (attempts >= WEBHOOK_POLICY.maxAttempts) return null;
  const table = WEBHOOK_POLICY.backoffSec;
  return table[Math.min(Math.max(attempts, 1), table.length) - 1]!;
}

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// ───────────────────────── Payloads (no PII) ─────────────────────────

export interface WebhookOrderData {
  number: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string | null;
  carrier: string;
  deliveryZone: string;
  region: string | null;
  district: string | null;
  subtotalUzs: number;
  discountUzs: number;
  shippingUzs: number;
  totalUzs: number;
  promoCode: string | null;
  source: string;
  locale: string;
  items: { sku: string; qty: number; priceUzs: number }[];
  createdAt: string;
  /** status_changed: the transition. */
  change?: { from: string | null; to: string | null };
}

export interface WebhookCustomerData {
  id: string;
  locale: string;
  leadSource: string | null;
  createdAt: string;
}

export interface WebhookReviewData {
  id: string;
  productSlug: string;
  rating: number;
  hasPhotos: boolean;
  createdAt: string;
}

export interface WebhookEnvelope<T = unknown> {
  /** Delivery id: stable across retries (receiver idempotency key). */
  id: string;
  type: WebhookEvent | typeof WEBHOOK_TEST_EVENT;
  createdAt: string;
  data: T;
}

// ───────────────────────── Admin DTOs ─────────────────────────

export interface WebhookEndpointDto {
  id: string;
  name: string;
  url: string;
  /** Host only, for the A10 table. */
  host: string;
  events: WebhookEvent[];
  active: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  /** Masked: `whsec_••••<last 4>`. */
  secretMasked: string;
  createdAt: string;
  updatedAt: string;
  stats24h: { delivered: number; failed: number; pending: number };
}

export interface WebhookListDto {
  items: WebhookEndpointDto[];
  events: WebhookEvent[];
  /** Per event: endpoints subscribed and deliveries delivered in the last 24 h (A10 table). */
  byEvent: { event: WebhookEvent; destinations: string[]; delivered24h: number }[];
}

/** Returned once, on create and on secret rotation. */
export interface WebhookSecretDto {
  endpoint: WebhookEndpointDto;
  secret: string;
}

export interface WebhookDeliveryDto {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WebhookDeliveryPageDto {
  items: WebhookDeliveryDto[];
  nextCursor: string | null;
}

export interface WebhookTestResultDto {
  ok: boolean;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  delivery: WebhookDeliveryDto;
}

// ───────────────────────── API keys ─────────────────────────

export const API_KEY_SCOPES = ['products:read', 'stock:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_POLICY = {
  defaultRatePerMin: 60,
  maxRatePerMin: 600,
  /** `lastUsedAt` is written at most this often per key. */
  touchEverySec: 60,
  maxActiveKeys: 20,
  /** Visible prefix of every key. */
  keyPrefix: 'fk_live_',
} as const;

export interface ApiKeyDto {
  id: string;
  name: string;
  /** `fk_live_<prefix>_••••<last 4>` */
  masked: string;
  scopes: ApiKeyScope[];
  rateLimitPerMin: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiKeyCreatedDto {
  key: ApiKeyDto;
  /** The full key, shown once. */
  secret: string;
}

// ───────────────────────── Partner API (read-only) ─────────────────────────

export interface PartnerVariantDto {
  sku: string;
  label: { uz: string; ru: string };
  priceUzs: number;
  compareAtUzs: number | null;
  available: number;
  active: boolean;
}

export interface PartnerProductDto {
  id: string;
  slug: string;
  type: string;
  name: { uz: string; ru: string };
  shortDescription: { uz: string; ru: string };
  categories: string[];
  url: { uz: string; ru: string };
  images: string[];
  variants: PartnerVariantDto[];
  updatedAt: string;
}

export interface PartnerProductPageDto {
  items: PartnerProductDto[];
  nextCursor: string | null;
}

export interface PartnerStockDto {
  items: { sku: string; available: number; active: boolean; updatedAt: string }[];
  nextCursor: string | null;
}
