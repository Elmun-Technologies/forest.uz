import type { OrderStatus } from './order-state';

/**
 * A13 MoySklad (docs/08): zod-free constants and DTOs shared by the API and the admin UI. The
 * settings schema lives in `schemas/admin-moysklad.ts`; decisions in CLAUDE.md §6.
 */

/** Data flows of the design's "Ma'lumot oqimi" table, each switchable. */
export const MOYSKLAD_FLOWS = [
  'products',
  'prices',
  'stock',
  'orders',
  'customers',
  'statuses',
  'webhooks',
] as const;
export type MoyskladFlow = (typeof MOYSKLAD_FLOWS)[number];

/** Order statuses mirrored to MoySklad (an order is pushed once it is CONFIRMED). */
export const MOYSKLAD_PUSH_STATUSES = [
  'CONFIRMED',
  'PACKING',
  'READY',
  'HANDED_TO_COURIER',
  'DELIVERED',
  'COMPLETED',
] as const satisfies readonly OrderStatus[];

export const MOYSKLAD_MIRRORED_STATUSES = [
  ...MOYSKLAD_PUSH_STATUSES,
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
] as const satisfies readonly OrderStatus[];
export type MoyskladMirroredStatus = (typeof MOYSKLAD_MIRRORED_STATUSES)[number];

/**
 * Default state names: MoySklad's stock customer-order states (a new account has them in Russian).
 * Empty = leave the MoySklad state as it is for that status.
 */
export const MOYSKLAD_DEFAULT_STATE_MAP: Record<MoyskladMirroredStatus, string> = {
  CONFIRMED: 'Подтвержден',
  PACKING: 'Собран',
  READY: 'Собран',
  HANDED_TO_COURIER: 'Отгружен',
  DELIVERED: 'Доставлен',
  COMPLETED: 'Доставлен',
  CANCELLED: 'Отменен',
  RETURN_REQUESTED: '',
  RETURNED: 'Возврат',
};

export const MOYSKLAD_DEFAULT_PRICE_TYPE = 'Chakana';
export const MOYSKLAD_STOCK_POLL_MINUTES = { min: 1, max: 60, default: 5 } as const;

export interface MoyskladSettings {
  /** salePrices[].priceType.name used for our price. */
  priceType: string;
  /** Store (warehouse) id whose stock we sell; null = all stores. */
  storeId: string | null;
  /** Legal entity for customer orders; null = the account's first organization. */
  organizationId: string | null;
  /** Product custom attribute holding the IKPU (MXIK) code. */
  ikpuAttribute: string;
  /** Customer-order custom attribute for the delivery method; empty = not sent. */
  deliveryAttribute: string;
  /** Counterparty used when the customers flow is off (e.g. "Розничный покупатель"). */
  defaultCounterpartyId: string | null;
  /** Reserve pushed order positions in MoySklad (our hold is handed over). */
  reserve: boolean;
  stockPollMinutes: number;
  stateMap: Record<MoyskladMirroredStatus, string>;
  flows: Record<MoyskladFlow, boolean>;
  /** Orders created before this moment are never pushed (set when the orders flow goes on). */
  pushSince: string | null;
}

/** Sync log kinds (IntegrationLog.kind for `moysklad`) shown in the design's "Sinxron jurnali". */
export const MOYSKLAD_LOG_KINDS = [
  'product',
  'price',
  'stock',
  'order',
  'status',
  'counterparty',
  'webhook',
  'sync',
] as const;
export type MoyskladLogKind = (typeof MOYSKLAD_LOG_KINDS)[number];

export interface MoyskladLogEntryDto {
  id: string;
  at: string;
  kind: string;
  /** IN = MoySklad → site, OUT = site → MoySklad. */
  direction: 'IN' | 'OUT';
  ok: boolean;
  message: string;
}

export interface MoyskladLogPageDto {
  items: MoyskladLogEntryDto[];
  nextCursor: string | null;
}

export type MoyskladConnection = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface MoyskladStatusDto {
  connection: MoyskladConnection;
  /** PROVIDERS_MODE=fake: the fake provider answers (dev/CI). */
  usingFake: boolean;
  lastError: string | null;
  kpis: {
    lastSyncAt: string | null;
    lastStockSyncAt: string | null;
    linkedSkus: number;
    totalSkus: number;
    ordersPushedToday: number;
    /** Failed log rows in the last 24 h + orders waiting for a retry. */
    errors24h: number;
    ordersFailing: number;
  };
  settings: MoyskladSettings;
  connectionInfo: {
    /** Last 4 characters only. */
    tokenMasked: string | null;
    /** Webhook URL with the secret path token masked; full value via the audited reveal. */
    webhookUrlMasked: string | null;
  };
  /** docs/02 conflict rules as applied by the sync (read-only on the page). */
  sourceOfTruth: { source: 'moysklad' | 'local'; price: boolean; stock: boolean };
}

export interface MoyskladSyncResultDto {
  queued: true;
  scope: MoyskladSyncScope;
}

export const MOYSKLAD_SYNC_SCOPES = ['all', 'stock', 'orders'] as const;
export type MoyskladSyncScope = (typeof MOYSKLAD_SYNC_SCOPES)[number];

export interface MoyskladWebhookRevealDto {
  webhookUrl: string;
}

export interface MoyskladWebhooksResultDto {
  created: number;
  existing: number;
}
