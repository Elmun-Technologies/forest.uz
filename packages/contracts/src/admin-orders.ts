/**
 * Admin orders (A6 list, A7 detail) — zod-free tabs, action keys and DTOs, so the admin UI can
 * import them from `@forest/contracts/core`. Inputs (zod) live in `schemas/admin-orders.ts`.
 */
import type { Carrier } from './delivery';
import type { ErrorCode } from './errors';
import type { DeliveryStatus, OrderStatus, PaymentMethod, PaymentStatus } from './order-state';

/** A6 status tabs (CLAUDE.md §6 maps each to our order/payment/SLA states). */
export const ADMIN_ORDER_TABS = [
  'all',
  'confirm',
  'awaiting_payment',
  'to_pack',
  'in_transit',
  'sla_risk',
  'delivered',
  'returns',
  'cancelled',
] as const;
export type AdminOrderTab = (typeof ADMIN_ORDER_TABS)[number];

/** Order statuses each status-only tab covers (`sla_risk` adds a deadline condition). */
export const ADMIN_TAB_STATUSES: Record<
  Exclude<AdminOrderTab, 'all' | 'confirm' | 'awaiting_payment'>,
  readonly OrderStatus[]
> = {
  to_pack: ['CONFIRMED', 'PACKING', 'READY'],
  in_transit: ['HANDED_TO_COURIER'],
  // Open fulfilment: the delivery promise still matters.
  sla_risk: ['CONFIRMED', 'PACKING', 'READY', 'HANDED_TO_COURIER'],
  delivered: ['DELIVERED', 'COMPLETED'],
  returns: ['RETURN_REQUESTED', 'RETURNED'],
  cancelled: ['CANCELLED'],
};

/** docs/02: < 1 h left is critical. */
export const SLA_RISK_WINDOW_MS = 3_600_000;

export const ADMIN_ORDER_SORTS = ['created_desc', 'created_asc', 'sla_asc', 'total_desc'] as const;
export type AdminOrderSort = (typeof ADMIN_ORDER_SORTS)[number];

/** Payment filter on the list: settled money, not the raw attempt rows. */
export const ADMIN_PAYMENT_FILTERS = ['paid', 'unpaid', 'refunded'] as const;
export type AdminPaymentFilter = (typeof ADMIN_PAYMENT_FILTERS)[number];

export const ADMIN_ORDER_SOURCES = ['web', 'bot', 'phone', 'admin'] as const;
export type AdminOrderSource = (typeof ADMIN_ORDER_SOURCES)[number];

export type SlaStateDto = 'OK' | 'AT_RISK' | 'LATE';

/** Statuses during which the delivery promise is running (SLA shown and counted). */
export const SLA_OPEN_STATUSES: readonly OrderStatus[] = ADMIN_TAB_STATUSES.sla_risk;

/** Actions the A7 page may offer; the API decides which ones the actor gets (`orderActions`). */
export const ADMIN_ORDER_ACTIONS = [
  'confirm_cod',
  'cod_settled',
  'start_packing',
  'mark_ready',
  'yandex_create_claim',
  'yandex_accept_claim',
  'yandex_cancel_claim',
  'yandex_refresh',
  'yandex_mark_returned',
  'bts_update',
  'mark_delivered',
  'record_receipt',
  'complete',
  'cancel',
  'refund',
  'add_note',
  'reveal_pii',
] as const;
export type AdminOrderActionKey = (typeof ADMIN_ORDER_ACTIONS)[number];

export interface AdminOrderActionDto {
  key: AdminOrderActionKey;
  /** Visible but refused right now, with the reason the server would give. */
  blockedBy: ErrorCode | null;
}

export interface AdminOrderListItemDto {
  id: string;
  number: string;
  createdAt: string;
  status: OrderStatus;
  source: string;
  customer: {
    id: string;
    name: string;
    /** Region label (city-level, never the address line). */
    city: string;
    phoneMasked: string;
  };
  itemsSummary: string;
  itemsCount: number;
  totalSoum: number;
  payment: { method: PaymentMethod; status: PaymentStatus | null };
  carrier: Carrier;
  delivery: { status: DeliveryStatus; trackNumber: string | null };
  slaDueAt: string | null;
  /** Only while fulfilment is open (`SLA_OPEN_STATUSES`). */
  sla: SlaStateDto | null;
}

export interface AdminOrderPageDto {
  items: AdminOrderListItemDto[];
  nextCursor: string | null;
  /** Per-tab counts for the current filters (search, payment, carrier, source, dates). */
  counts: Record<AdminOrderTab, number>;
  /** KPI tiles: open orders in transit per carrier. */
  inTransitByCarrier: Record<Carrier, number>;
  serverNow: string;
}

export interface AdminOrderBadgeDto {
  /** Orders needing staff action: COD to confirm + to pack/ship. */
  count: number;
  slaRisk: number;
}

export interface AdminOrderItemDto {
  id: string;
  name: string;
  variantLabel: string;
  sku: string;
  ikpu: string;
  qty: number;
  unitSoum: number;
  discountSoum: number;
  lineSoum: number;
  image: string | null;
}

export interface AdminRefundDto {
  id: string;
  amountSoum: number;
  reason: string;
  createdAt: string;
  /** Staff name, or the provider for provider-initiated refunds. */
  by: string;
}

export interface AdminPaymentDto {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountSoum: number;
  refundedSoum: number;
  providerTxnId: string | null;
  createdAt: string;
  performedAt: string | null;
  cancelledAt: string | null;
  fiscalReceiptUrl: string | null;
  refunds: AdminRefundDto[];
}

export interface AdminShipmentHistoryDto {
  at: string;
  status: DeliveryStatus;
  providerStatus: string | null;
  place: string | null;
  note: string | null;
}

export interface AdminShipmentDto {
  id: string;
  carrier: Carrier;
  status: DeliveryStatus;
  providerStatus: string | null;
  /** Yandex claim id or BTS waybill. */
  externalId: string | null;
  trackNumber: string | null;
  branch: string | null;
  priceSoum: number;
  acceptedAt: string | null;
  /** Yandex: a staff accept is in flight. */
  acceptPending: boolean;
  courier: {
    name: string;
    car: string | null;
    plate: string | null;
    phoneMasked: string | null;
    etaAt: string | null;
  } | null;
  history: AdminShipmentHistoryDto[];
}

export interface AdminTimelineEntryDto {
  id: string;
  at: string;
  type: string;
  from: string | null;
  to: string | null;
  actor: { type: string; name: string | null };
  /** Internal note text (type NOTE) or a short operator note on carrier updates. */
  note: string | null;
  /** Non-PII details (carrier, claim id, template, reason…). */
  data: Record<string, string | number | boolean | null>;
}

export type OrderStepKey =
  'NEW' | 'CONFIRMED' | 'PACKING' | 'READY' | 'HANDED_TO_COURIER' | 'DELIVERED' | 'COMPLETED';

export interface AdminOrderStepDto {
  key: OrderStepKey;
  at: string | null;
  state: 'done' | 'current' | 'upcoming';
}

export interface AdminOrderCustomerDto {
  id: string;
  publicId: string;
  name: string | null;
  ordersCount: number;
  ltvSoum: number;
  /** Position of this order among the customer's orders (1 = first). */
  nth: number;
  tags: string[];
}

export interface AdminOrderDetailDto {
  id: string;
  number: string;
  publicId: string;
  status: OrderStatus;
  createdAt: string;
  source: string;
  locale: 'uz' | 'ru';
  promoCode: string | null;
  comment: string | null;
  cancelReason: string | null;
  zone: { key: string; name: string };
  carrier: Carrier;
  slaDueAt: string | null;
  sla: SlaStateDto | null;
  serverNow: string;
  contact: {
    name: string;
    phoneMasked: string;
    region: string;
    district: string | null;
  };
  items: AdminOrderItemDto[];
  totals: { subtotalSoum: number; discountSoum: number; shippingSoum: number; totalSoum: number };
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus | null;
  payments: AdminPaymentDto[];
  fiscal: {
    evidence: 'receipt' | 'payment_url' | 'payme_detail' | null;
    receipt: { receiptNumber: string | null; url: string | null; createdAt: string } | null;
  };
  shipments: AdminShipmentDto[];
  steps: AdminOrderStepDto[];
  actions: AdminOrderActionDto[];
  timeline: AdminTimelineEntryDto[];
  customer: AdminOrderCustomerDto | null;
}

/** `POST /admin/orders/:number/pii` — what this staff member may see in full. */
export interface AdminOrderPiiDto {
  phone: string | null;
  address: { region: string; district: string | null; line: string } | null;
}

export interface AdminVariantOptionDto {
  id: string;
  sku: string;
  name: string;
  label: string;
  priceSoum: number;
  available: number;
}

export interface AdminManualOrderResultDto {
  number: string;
}

/** Remaining refundable amount of a payment (tiyin math stays in the API). */
export function refundableSoum(p: Pick<AdminPaymentDto, 'amountSoum' | 'refundedSoum'>): number {
  return Math.max(0, p.amountSoum - p.refundedSoum);
}

/** Result of an A7 action; `noop` = the order already was in that state (nothing written). */
export interface AdminOrderActionResultDto {
  ok: true;
  noop: boolean;
}

export interface AdminRefundResultDto {
  refundId: string;
  /** The whole payment is refunded (before shipping this also cancelled the order). */
  full: boolean;
}
