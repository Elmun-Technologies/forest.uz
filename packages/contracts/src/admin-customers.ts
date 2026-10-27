/**
 * Admin A4 Customers / A5 Customer 360° (basic). Zod-free: the admin UI imports constants and DTO
 * types from `@forest/contracts/core`; input schemas live in `schemas/admin-customers.ts`.
 */
import type { PaymentMethod, PaymentStatus, OrderStatus } from './order-state';

export const CUSTOMER_SEGMENTS = ['all', 'new', 'loyal', 'abandoned', 'inactive', 'leads'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];
export type CustomerSegmentTag = Exclude<CustomerSegment, 'all'>;

/**
 * Segment definitions (CLAUDE.md §6). A purchase = an order with a PAID/PARTIALLY_REFUNDED
 * payment; LTV = those payments minus their refunds.
 * - new: customer created ≤ `newDays` ago
 * - loyal: ≥ `loyalPurchases` purchases or LTV ≥ `loyalLtvSoum`
 * - abandoned: a non-converted cart with items, last changed between `abandonedDays` ago and
 *   `messaging.rules.abandonedCartMinutes` ago, and no order created since that change
 * - inactive: last activity more than `inactiveDays` ago
 * - leads: no purchase yet
 */
export const CUSTOMER_SEGMENT_RULES = {
  newDays: 30,
  loyalPurchases: 2,
  loyalLtvSoum: 2_000_000,
  abandonedDays: 7,
  inactiveDays: 60,
} as const;

/** Row badge: the first segment of this list the customer belongs to. */
export const CUSTOMER_SEGMENT_PRIORITY: readonly CustomerSegmentTag[] = [
  'abandoned',
  'inactive',
  'loyal',
  'leads',
  'new',
];

export const CUSTOMER_SORTS = ['activity', 'ltv', 'orders', 'created'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** Orders that still need the customer's contact data: erasure waits for them. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PACKING',
  'READY',
  'HANDED_TO_COURIER',
  'RETURN_REQUESTED',
];

/** CSV export cap (rows). */
export const CUSTOMER_EXPORT_MAX_ROWS = 20_000;

export interface CustomerListItemDto {
  id: string;
  publicId: string;
  name: string | null;
  /** `+998 90 *** ** 67`; null for Telegram-only customers. */
  phoneMasked: string | null;
  hasTelegram: boolean;
  /** Region code (`UZ_REGIONS`). */
  region: string | null;
  firstSource: string | null;
  purchases: number;
  ltvSoum: number;
  lastActivityAt: string;
  createdAt: string;
  /** Ordered by `CUSTOMER_SEGMENT_PRIORITY`. */
  segments: CustomerSegmentTag[];
  consents: { sms: boolean; telegram: boolean };
  tags: string[];
}

export interface CustomerListDto {
  items: CustomerListItemDto[];
  nextCursor: string | null;
  /** Matching the current filters and segment. */
  total: number;
  /** Per segment, with the other filters applied (chip counts). */
  counts: Record<CustomerSegment, number>;
}

export interface CustomerFilterOptionsDto {
  regions: string[];
  sources: string[];
  /** Products bought at least once (paid orders). */
  products: { id: string; name: string }[];
}

export interface CustomerOrderRowDto {
  id: string;
  number: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** Displayed payment status (PAID/REFUNDED rows win, like the order page). */
  paymentStatus: PaymentStatus | null;
  totalSoum: number;
  carrier: string;
}

export interface CustomerConsentEntryDto {
  channel: string;
  granted: boolean;
  source: string;
  at: string;
}

export interface CustomerNoteDto {
  id: string;
  text: string;
  staffName: string | null;
  createdAt: string;
}

export type CustomerTimelineItemDto =
  | { kind: 'created'; at: string }
  | { kind: 'lead'; at: string; source: string | null }
  | {
      kind: 'order_created';
      at: string;
      orderNumber: string;
      totalSoum: number;
      paymentMethod: PaymentMethod;
    }
  | {
      kind: 'order_event';
      at: string;
      orderNumber: string;
      type: string;
      from: string | null;
      to: string | null;
      actorType: string;
    }
  | {
      kind: 'message';
      at: string;
      channel: string;
      templateKey: string | null;
      status: string;
      marketing: boolean;
    }
  | { kind: 'consent'; at: string; channel: string; granted: boolean; source: string }
  | { kind: 'review'; at: string; rating: number; status: string }
  | { kind: 'note'; at: string; staffName: string | null };

export interface CustomerDetailDto {
  id: string;
  publicId: string;
  name: string | null;
  phoneMasked: string | null;
  hasPhone: boolean;
  hasTelegram: boolean;
  region: string | null;
  firstSource: string | null;
  /** First touch as stored (no click ids), shown only when present. */
  firstTouch: { source: string | null; medium: string | null; campaign: string | null } | null;
  locale: 'uz' | 'ru';
  createdAt: string;
  lastActivityAt: string;
  tags: string[];
  segments: CustomerSegmentTag[];
  erasedAt: string | null;
  /** Pending cabinet erasure request (docs/02: within `deletionSlaDays`). */
  erasureRequest: { requestedAt: string; dueBy: string } | null;
  kpis: { ltvSoum: number; purchases: number; aovSoum: number | null; ordersTotal: number };
  /** Latest orders only (50); `kpis.ordersTotal` counts all. */
  orders: CustomerOrderRowDto[];
  ordersTruncated: boolean;
  /** Copies in external systems (MoySklad counterparties) — erased by hand after an erasure. */
  external: CustomerEraseResultDto['external'];
  consents: {
    current: { smsMarketing: boolean; telegram: boolean; adsMatching: boolean };
    history: CustomerConsentEntryDto[];
  };
  addressesCount: number;
  openOrders: number;
  notes: CustomerNoteDto[];
  timeline: CustomerTimelineItemDto[];
  /** Older events exist beyond the shown window (orders/events/messages are capped). */
  timelineTruncated: boolean;
}

/** Unmasked data (`POST /admin/customers/:id/reveal`, audited). */
export interface CustomerPiiDto {
  phone: string | null;
  telegramUsername: string | null;
  addresses: {
    id: string;
    label: string | null;
    region: string;
    district: string | null;
    line: string;
    isDefault: boolean;
  }[];
}

export interface CustomerEraseResultDto {
  erasedAt: string;
  ordersKept: number;
  /** Customer review photos detached (files deleted when nothing else uses them). */
  photosRemoved: number;
  /**
   * Copies in external systems that are NOT erased automatically — staff erase them by hand
   * (docs/runbooks/moysklad.md).
   */
  external: { system: 'moysklad'; counterpartyId: string }[];
}

/** CSV cell: quoted, formula-injection safe (`= + - @` → `'` prefix). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
