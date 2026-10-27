import { createHmac } from 'node:crypto';
import type { DeliveryStatus } from '@forest/contracts';
import type { HttpClient } from '../http-client';
import type {
  CourierInfo,
  DeliveryAddress,
  DeliveryProvider,
  HealthResult,
  ShipmentInput,
  ShipmentState,
} from './types';

/**
 * Yandex Delivery — Express Claims API v2 (`b2b.taxi.yandex.net/b2b/cargo/integration/v2`), the
 * non-Russia flow: check-price → claims/create → claims/accept → claims/info (+ points-eta,
 * driver-voiceforwarding) → claims/cancel-info → claims/cancel.
 * Sources and what is unverified: docs/runbooks/delivery.md. Builders and the status mapping are
 * pure so they are unit-tested without the network.
 */

export const YANDEX_DEFAULT_API_URL = 'https://b2b.taxi.yandex.net';
const PREFIX = '/b2b/cargo/integration/v2';

/** Every claim status named in the official enum (claims/search) and the status-model page. */
export const YANDEX_CLAIM_STATUSES = [
  'new',
  'estimating',
  'estimating_failed',
  'ready_for_approval',
  'accepted',
  'performer_lookup',
  'performer_draft',
  'performer_found',
  'performer_not_found',
  'pickup_arrived',
  'ready_for_pickup_confirmation',
  'pickuped',
  'delivery_arrived',
  'ready_for_delivery_confirmation',
  'pay_waiting',
  'delivered',
  'delivered_finish',
  'returning',
  'return_arrived',
  'ready_for_return_confirmation',
  'returned',
  'returned_finish',
  'failed',
  'cancelled',
  'cancelled_with_payment',
  'cancelled_by_taxi',
  'cancelled_with_items_on_hands',
] as const;
export type YandexClaimStatus = (typeof YANDEX_CLAIM_STATUSES)[number];

const STATUS_MAP: Record<YandexClaimStatus, DeliveryStatus> = {
  new: 'CREATED',
  estimating: 'CREATED',
  ready_for_approval: 'CREATED',
  accepted: 'CREATED',
  performer_lookup: 'CREATED',
  performer_draft: 'CREATED',
  performer_found: 'COURIER_ASSIGNED',
  pickup_arrived: 'COURIER_ASSIGNED',
  ready_for_pickup_confirmation: 'COURIER_ASSIGNED',
  pickuped: 'PICKED_UP',
  delivery_arrived: 'IN_TRANSIT',
  ready_for_delivery_confirmation: 'IN_TRANSIT',
  pay_waiting: 'IN_TRANSIT',
  delivered: 'DELIVERED',
  delivered_finish: 'DELIVERED',
  // The parcel is on its way back: delivery failed, the return isn't complete yet.
  returning: 'FAILED',
  return_arrived: 'FAILED',
  ready_for_return_confirmation: 'FAILED',
  returned: 'RETURNED',
  returned_finish: 'RETURNED',
  // Dead claims: staff may create a new one (FAILED → CREATED is allowed).
  estimating_failed: 'FAILED',
  performer_not_found: 'FAILED',
  failed: 'FAILED',
  cancelled: 'FAILED',
  cancelled_with_payment: 'FAILED',
  cancelled_by_taxi: 'FAILED',
  cancelled_with_items_on_hands: 'FAILED',
};

/** Claim statuses after which Yandex never changes the claim again (polling stops). */
export const YANDEX_TERMINAL_STATUSES: readonly YandexClaimStatus[] = [
  'delivered_finish',
  'returned_finish',
  'estimating_failed',
  'performer_not_found',
  'failed',
  'cancelled',
  'cancelled_with_payment',
  'cancelled_by_taxi',
  'cancelled_with_items_on_hands',
];

/**
 * FAILED statuses that prove a courier took the parcel (it is coming back / still with them). Seen
 * without `pickuped` (polling skips statuses), they still mean the order left the warehouse.
 */
const PARCEL_OUT_FAILED: readonly YandexClaimStatus[] = [
  'returning',
  'return_arrived',
  'ready_for_return_confirmation',
  'cancelled_with_items_on_hands',
];

export function yandexParcelOutFailed(status: string): boolean {
  return (PARCEL_OUT_FAILED as readonly string[]).includes(status);
}

/** Forwarded courier numbers without `ttl_seconds` are trusted this long. */
export const COURIER_PHONE_DEFAULT_TTL_MS = 30 * 60_000;

/** A courier is on the claim: ETA and the forwarded phone are worth asking for. */
const COURIER_PHASES: readonly YandexClaimStatus[] = [
  'performer_found',
  'pickup_arrived',
  'ready_for_pickup_confirmation',
  'pickuped',
  'delivery_arrived',
  'ready_for_delivery_confirmation',
  'pay_waiting',
];

export function isYandexClaimStatus(value: string): value is YandexClaimStatus {
  return (YANDEX_CLAIM_STATUSES as readonly string[]).includes(value);
}

/** Yandex claim status → our carrier-independent status; null for a status we don't know. */
export function yandexStatusToDelivery(status: string): DeliveryStatus | null {
  return isYandexClaimStatus(status) ? STATUS_MAP[status] : null;
}

export function isYandexTerminal(status: string): boolean {
  return (YANDEX_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Yandex callbacks are unsigned: our callback URL carries this derived secret (constant per install). */
export function yandexCallbackKey(appSecret: string): string {
  return createHmac('sha256', appSecret)
    .update('yandex_delivery:callback')
    .digest('hex')
    .slice(0, 40);
}

/**
 * Docs: query parameters are appended to `callback_url` by concatenation, so the URL must end in a
 * way that keeps the result valid — ours ends with `&`.
 */
export function yandexCallbackUrl(apiUrl: string, appSecret: string): string {
  return `${apiUrl.replace(/\/$/, '')}/v1/webhooks/yandex-delivery?key=${yandexCallbackKey(appSecret)}&`;
}

/** Decimal so'm string ("30000", "30000.50") → tiyin, rounded up to a whole tiyin; null if malformed. */
export function decimalSoumToTiyin(value: unknown): bigint | null {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const m = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m?.[1]) return null;
  const frac = (m[2] ?? '').padEnd(6, '0');
  const tiyin = BigInt(m[1]) * 100n + BigInt(frac.slice(0, 2));
  return /[1-9]/.test(frac.slice(2)) ? tiyin + 1n : tiyin;
}

function tiyinToDecimalSoum(tiyin: bigint): string {
  return `${tiyin / 100n}.${(tiyin % 100n).toString().padStart(2, '0')}`;
}

// ── Credentials ──

export interface YandexWarehouse {
  fullname: string;
  lat: number;
  lng: number;
  contactName: string;
  contactPhone: string;
}

export type YandexTaxiClass = 'courier' | 'express' | 'cargo';

export interface YandexConfig {
  token: string;
  /** `test`: quotes and claim creation work, accept is refused (no sandbox exists). */
  mode: 'test' | 'live';
  warehouse: YandexWarehouse | null;
  taxiClass: YandexTaxiClass;
  callbacks: boolean;
  allowCod: boolean;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Integration form values (strings) → typed config. The warehouse is null until complete. */
export function yandexConfig(c: Record<string, string>): YandexConfig {
  const lat = num(c.sourceLat);
  const lng = num(c.sourceLng);
  const warehouse =
    c.sourceAddress &&
    c.sourceContactName &&
    c.sourceContactPhone &&
    lat !== null &&
    lng !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
      ? {
          fullname: c.sourceAddress,
          lat,
          lng,
          contactName: c.sourceContactName,
          contactPhone: c.sourceContactPhone,
        }
      : null;
  const taxiClass = (['courier', 'express', 'cargo'] as const).find((t) => t === c.taxiClass);
  return {
    token: c.oauthToken ?? '',
    mode: c.mode === 'live' ? 'live' : 'test',
    warehouse,
    taxiClass: taxiClass ?? 'express',
    callbacks: c.callbacks === 'on',
    allowCod: c.allowCod === 'on',
  };
}

// ── Request builders ──

/** Yandex takes coordinates as [longitude, latitude]. */
const coords = (lat: number, lng: number): [number, number] => [lng, lat];

const DEFAULT_ITEM_GRAMS = 1000;
const kg = (grams: number) => Math.max(0.01, Math.round(grams) / 1000);

export function buildCheckPriceBody(
  warehouse: YandexWarehouse,
  dest: { lat: number; lng: number; fullname: string },
  weightGrams: number,
  taxiClass: YandexTaxiClass,
) {
  return {
    // One destination: the item needs only its pickup point (dropoff is mandatory with several).
    items: [{ quantity: 1, weight: kg(weightGrams), pickup_point: 1 }],
    route_points: [
      { id: 1, coordinates: coords(warehouse.lat, warehouse.lng), fullname: warehouse.fullname },
      { id: 2, coordinates: coords(dest.lat, dest.lng), fullname: dest.fullname },
    ],
    requirements: { taxi_class: taxiClass },
  };
}

export function destinationFullname(address: DeliveryAddress): string {
  return [address.region, address.district, address.line]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(', ');
}

export function buildClaimBody(
  input: ShipmentInput,
  config: YandexConfig & { warehouse: YandexWarehouse },
  callbackUrl: string | null,
) {
  const w = config.warehouse;
  const items = (
    input.items?.length
      ? input.items
      : [
          {
            title: `Forest ${input.orderNumber}`,
            sku: input.orderNumber,
            qty: Math.max(1, input.itemsCount),
            unitPriceTiyin: 0n,
            weightGrams: Math.round(input.weightGrams / Math.max(1, input.itemsCount)),
          },
        ]
  ).map((i) => ({
    title: i.title.slice(0, 255),
    quantity: i.qty,
    cost_value: tiyinToDecimalSoum(i.unitPriceTiyin),
    cost_currency: 'UZS',
    weight: kg(i.weightGrams ?? DEFAULT_ITEM_GRAMS),
    pickup_point: 1,
    extra_id: i.sku,
  }));
  const commentParts = [input.comment?.trim() || null];
  if (input.codAmountTiyin !== null && input.codAmountTiyin > 0n)
    commentParts.push(
      `Naqd to'lov / оплата при получении: ${tiyinToDecimalSoum(input.codAmountTiyin)} UZS`,
    );
  const comment = commentParts.filter(Boolean).join('. ');
  const dest = input.address;
  return {
    items,
    route_points: [
      {
        point_id: 1,
        visit_order: 1,
        type: 'source',
        contact: { name: w.contactName, phone: w.contactPhone },
        address: { fullname: w.fullname, coordinates: coords(w.lat, w.lng) },
      },
      {
        point_id: 2,
        visit_order: 2,
        type: 'destination',
        contact: { name: input.recipientName, phone: input.recipientPhone },
        address: {
          fullname: destinationFullname(dest),
          ...(dest.lat != null && dest.lng != null
            ? { coordinates: coords(dest.lat, dest.lng) }
            : {}),
        },
        external_order_id: input.orderNumber,
      },
    ],
    client_requirements: { taxi_class: config.taxiClass },
    emergency_contact: { name: w.contactName, phone: w.contactPhone },
    ...(comment ? { comment: comment.slice(0, 7000) } : {}),
    ...(callbackUrl ? { callback_properties: { callback_url: callbackUrl } } : {}),
  };
}

// ── Response parsing ──

export interface YandexClaim {
  id: string;
  status: string;
  version: number;
  updatedAt: Date | null;
  revision: number | null;
  priceTiyin: bigint | null;
  currency: string | null;
  performer: {
    name: string | null;
    car: string | null;
    plate: string | null;
    transport: string | null;
  } | null;
  errors: { code: string; message: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function parseClaim(body: unknown): YandexClaim {
  if (!isObj(body) || !str(body.id) || !str(body.status))
    throw new YandexApiError(200, 'bad_response', 'claim without id/status');
  const pricing = isObj(body.pricing) ? body.pricing : {};
  const offer = isObj(pricing.offer) ? pricing.offer : {};
  const p = isObj(body.performer_info) ? body.performer_info : null;
  const carModel = p ? str(p.car_model) : null;
  const carColor = p ? str(p.car_color) : null;
  return {
    id: str(body.id)!,
    status: str(body.status)!,
    version: int(body.version) ?? 1,
    updatedAt: date(body.updated_ts),
    revision: int(body.revision),
    priceTiyin: decimalSoumToTiyin(pricing.final_price ?? offer.price),
    currency:
      str(pricing.currency) ??
      (isObj(pricing.currency_rules) ? str(pricing.currency_rules.code) : null),
    performer: p
      ? {
          name: str(p.courier_name),
          car: [carColor, carModel].filter(Boolean).join(' ') || null,
          plate: str(p.car_number),
          transport: str(p.transport_type),
        }
      : null,
    errors: Array.isArray(body.error_messages)
      ? body.error_messages.filter(isObj).map((e) => ({
          code: str(e.code) ?? 'unknown',
          message: str(e.message) ?? '',
        }))
      : [],
  };
}

/** points-eta: expected arrival at the destination point. */
export function parseDestinationEta(body: unknown): Date | null {
  if (!isObj(body) || !Array.isArray(body.route_points)) return null;
  const dest = body.route_points.filter(isObj).find((p) => p.type === 'destination');
  const visited = dest && isObj(dest.visited_at) ? dest.visited_at : null;
  return visited ? date(visited.expected) : null;
}

export class YandexApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`yandex ${status} ${code}: ${message}`.slice(0, 300));
    this.name = 'YandexApiError';
  }
}

export type YandexLog = (entry: {
  kind: string;
  ok: boolean;
  message: string;
  payload?: Record<string, unknown>;
}) => void;

export interface YandexProviderOptions {
  http: HttpClient;
  /**
   * Client for live checkout quotes: its own circuit breaker and no retries, so slow or failing
   * `check-price` calls never open the breaker that claims and status sync depend on.
   */
  quoteHttp?: HttpClient;
  baseUrl?: string;
  /** Status callback URL (only sent when the `callbacks` field is on). */
  callbackUrl?: string | null;
  log?: YandexLog;
}

/** Cancel terms from claims/cancel-info. */
export type YandexCancelState = 'free' | 'paid' | 'unavailable';

export class YandexDeliveryProvider implements DeliveryProvider {
  readonly key = 'yandex_delivery' as const;
  readonly config: YandexConfig;
  private readonly baseUrl: string;

  constructor(
    credentials: Record<string, string>,
    private readonly opts: YandexProviderOptions,
  ) {
    this.config = yandexConfig(credentials);
    this.baseUrl = (opts.baseUrl || YANDEX_DEFAULT_API_URL).replace(/\/$/, '');
  }

  get isTestMode(): boolean {
    return this.config.mode === 'test';
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    opts: {
      query?: Record<string, string>;
      body?: unknown;
      idempotent: boolean;
      timeoutMs?: number;
      http?: HttpClient;
    },
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${PREFIX}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const res = await (opts.http ?? this.opts.http).request({
      method,
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Accept-Language': 'ru',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      idempotent: opts.idempotent,
      timeoutMs: opts.timeoutMs ?? 10_000,
    });
    let data: unknown = null;
    if (res.text) {
      try {
        data = JSON.parse(res.text);
      } catch {
        data = null;
      }
    }
    if (res.status < 200 || res.status >= 300) {
      const code = isObj(data) ? (str(data.code) ?? `http_${res.status}`) : `http_${res.status}`;
      const message = isObj(data) ? (str(data.message) ?? '') : '';
      throw new YandexApiError(res.status, code, message);
    }
    return data;
  }

  private logged<T>(
    kind: string,
    payload: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    return run().then(
      (r) => {
        this.opts.log?.({ kind, ok: true, message: 'ok', payload });
        return r;
      },
      (e: unknown) => {
        this.opts.log?.({ kind, ok: false, message: String(e), payload });
        throw e;
      },
    );
  }

  /** Harmless authenticated call: a one-row claim search. */
  async test(): Promise<HealthResult> {
    if (!this.config.token) return { ok: false, message: 'oauthToken is required' };
    try {
      await this.call('POST', 'claims/search', {
        body: { offset: 0, limit: 1 },
        idempotent: true,
      });
    } catch (e) {
      if (e instanceof YandexApiError && (e.status === 401 || e.status === 403))
        return { ok: false, message: 'token rejected by Yandex (401/403)' };
      return { ok: false, message: `Yandex API unreachable: ${String(e).slice(0, 200)}` };
    }
    if (!this.config.warehouse)
      return {
        ok: false,
        message: 'token ok; warehouse address, lat/lng and contact name/phone are required',
      };
    return {
      ok: true,
      message: this.isTestMode
        ? 'token ok (test mode: claims can be created, accept is blocked)'
        : 'token ok (live: accepted claims dispatch real couriers)',
    };
  }

  /**
   * Live price for the Tashkent express zone. Null (= zone price from settings) when either side
   * has no coordinates (no geocoding here), or the answer isn't a UZS price.
   */
  async quote(address: DeliveryAddress, weightGrams: number) {
    const w = this.config.warehouse;
    if (!w || address.lat == null || address.lng == null) return null;
    const body = buildCheckPriceBody(
      w,
      { lat: address.lat, lng: address.lng, fullname: destinationFullname(address) },
      weightGrams,
      this.config.taxiClass,
    );
    const res = await this.call('POST', 'check-price', {
      body,
      idempotent: true,
      timeoutMs: 3000,
      http: this.opts.quoteHttp,
    });
    if (!isObj(res)) return null;
    const rules = isObj(res.currency_rules) ? res.currency_rules : {};
    if (str(rules.code) !== 'UZS') return null;
    const priceTiyin = decimalSoumToTiyin(res.price);
    if (priceTiyin === null) return null;
    return { priceTiyin, etaMinutes: int(res.eta) ?? 0 };
  }

  /** claims/create — estimation only; nothing is dispatched until `accept`. */
  async createClaim(input: ShipmentInput): Promise<YandexClaim> {
    const w = this.config.warehouse;
    if (!w) throw new YandexApiError(0, 'warehouse_missing', 'warehouse is not configured');
    if (!input.idempotencyKey)
      throw new YandexApiError(0, 'request_id_missing', 'idempotency key required');
    const body = buildClaimBody(
      input,
      { ...this.config, warehouse: w },
      this.config.callbacks ? (this.opts.callbackUrl ?? null) : null,
    );
    return this.logged(
      'claims.create',
      { requestId: input.idempotencyKey, order: input.orderNumber },
      async () =>
        parseClaim(
          await this.call('POST', 'claims/create', {
            query: { request_id: input.idempotencyKey! },
            body,
            // Same request_id → Yandex returns the same claim, so retrying 5xx/timeouts is safe.
            idempotent: true,
          }),
        ),
    );
  }

  async createShipment(input: ShipmentInput) {
    const claim = await this.createClaim(input);
    return { externalId: claim.id, trackNumber: null };
  }

  async claimInfo(claimId: string): Promise<YandexClaim> {
    return parseClaim(
      await this.call('POST', 'claims/info', { query: { claim_id: claimId }, idempotent: true }),
    );
  }

  async getState(externalId: string, opts: { withPhone?: boolean } = {}): Promise<ShipmentState> {
    const claim = await this.claimInfo(externalId);
    const status = yandexStatusToDelivery(claim.status);
    const inCourierPhase = (COURIER_PHASES as readonly string[]).includes(claim.status);
    let courier: CourierInfo | null = null;
    if (claim.performer?.name) {
      courier = {
        name: claim.performer.name,
        phone: null,
        car: claim.performer.car,
        plate: claim.performer.plate,
        transport: claim.performer.transport,
        etaAt: null,
        distanceKm: null,
      };
      if (inCourierPhase) {
        // Best effort: a failing extra call must not hide the status change itself.
        courier.etaAt = await this.call('POST', 'claims/points-eta', {
          query: { claim_id: externalId },
          idempotent: true,
        })
          .then(parseDestinationEta)
          .catch(() => null);
        if (opts.withPhone) {
          const phone = await this.call('POST', 'driver-voiceforwarding', {
            body: { claim_id: externalId },
            idempotent: true,
          }).catch(() => null);
          if (isObj(phone) && str(phone.phone)) {
            courier.phone = str(phone.phone);
            courier.phoneExt = str(phone.ext);
            const ttl = int(phone.ttl_seconds);
            courier.phoneExpiresAt = new Date(
              Date.now() + (ttl ? ttl * 1000 : COURIER_PHONE_DEFAULT_TTL_MS),
            );
          }
        }
      }
    }
    return {
      status: status ?? 'CREATED',
      courier,
      trackNumber: null,
      history: [],
      providerStatus: claim.status,
      knownStatus: status !== null,
      updatedAt: claim.updatedAt,
      version: claim.version,
      terminal: isYandexTerminal(claim.status),
      carrierPriceTiyin: claim.currency === 'UZS' ? claim.priceTiyin : null,
      errors: claim.errors.map((e) => e.code),
    };
  }

  /** claims/accept — dispatches a real courier. Never retried automatically (not idempotent). */
  async accept(externalId: string, version?: number): Promise<void> {
    if (this.isTestMode)
      throw new YandexApiError(0, 'test_mode', 'accept is disabled in test mode');
    const v = version ?? (await this.claimInfo(externalId)).version;
    await this.logged('claims.accept', { claimId: externalId, version: v }, () =>
      this.call('POST', 'claims/accept', {
        query: { claim_id: externalId },
        body: { version: v },
        idempotent: false,
      }),
    );
  }

  async cancelInfo(
    externalId: string,
  ): Promise<{ state: YandexCancelState; priceTiyin: bigint | null }> {
    const res = await this.call('POST', 'claims/cancel-info', {
      query: { claim_id: externalId },
      idempotent: true,
    });
    const s = isObj(res) ? str(res.cancel_state) : null;
    const state: YandexCancelState = s === 'free' || s === 'paid' ? s : 'unavailable';
    return { state, priceTiyin: isObj(res) ? decimalSoumToTiyin(res.price) : null };
  }

  /** Free cancellation only, unless `allowPaid` (staff accepted the fee). */
  async cancel(externalId: string, opts: { allowPaid?: boolean } = {}): Promise<void> {
    const info = await this.cancelInfo(externalId);
    if (info.state === 'unavailable')
      throw new YandexApiError(409, 'cancel_unavailable', 'claim can no longer be cancelled');
    if (info.state === 'paid' && !opts.allowPaid)
      throw new YandexApiError(409, 'cancel_paid', 'cancellation is paid');
    const { version } = await this.claimInfo(externalId);
    await this.logged('claims.cancel', { claimId: externalId, state: info.state }, () =>
      this.call('POST', 'claims/cancel', {
        query: { claim_id: externalId },
        body: { version, cancel_state: info.state },
        idempotent: false,
      }),
    );
  }
}
