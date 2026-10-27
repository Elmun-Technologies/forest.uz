import { z } from 'zod';
import { uzPhoneSchema } from './common';
import type { ImageDto } from './catalog';
import type { DeliveryStatus, OrderStatus, PaymentMethod, PaymentStatus } from '../order-state';
import type { Locale } from '../locale';

// ───────── Cart ─────────

export const addCartItemSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(99).default(1),
});
export const setCartQtySchema = z.object({ qty: z.number().int().min(0).max(99) });
export const applyPromoSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .transform((s) => s.toUpperCase()),
});

export interface CartLineDto {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  variantLabel: string;
  sellerName: string;
  isOfficialSeller: boolean;
  image: ImageDto | null;
  qty: number;
  unitPriceSoum: number;
  compareAtSoum: number | null;
  lineTotalSoum: number;
  available: number;
  /** True when requested qty exceeds availability (UI shows a hint, checkout blocks). */
  insufficient: boolean;
  isGift: boolean;
}

export interface CartTotalsDto {
  itemsCount: number;
  subtotalSoum: number;
  discountSoum: number;
  /** null until a delivery zone is known. */
  shippingSoum: number | null;
  totalSoum: number;
  freeShippingRemainingSoum: number | null;
  freeShippingThresholdSoum: number | null;
}

export interface CartDto {
  id: string | null;
  lines: CartLineDto[];
  totals: CartTotalsDto;
  promo:
    | { code: string; status: 'applied'; discountSoum: number }
    | { code: string; status: 'rejected'; reason: string; message: string }
    | null;
  /** Cross-sell suggestion ("Tozalovchisiz rang notekis chiqadi"). */
  upsell: {
    productSlug: string;
    variantId: string;
    name: string;
    reason: string;
    priceSoum: number;
    image: ImageDto | null;
  } | null;
}

// ───────── Delivery quote ─────────

export const quoteQuerySchema = z.object({
  region: z.string().min(1),
  district: z.string().optional(),
  /** Customer's map pin: enables the live carrier quote where a zone has it on. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export interface DeliveryOptionDto {
  zoneKey: string;
  carrier: 'YANDEX' | 'BTS' | 'PICKUP';
  name: string;
  etaLabel: string;
  priceSoum: number;
  /** ISO time of the promised deadline if the order were confirmed now. */
  promiseAt: string;
  promiseKind: 'SAME_DAY' | 'NEXT_DAY' | 'WITHIN_HOURS';
}

// ───────── Checkout ─────────

export const checkoutSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: uzPhoneSchema,
  region: z.string().min(1),
  district: z.string().max(80).optional().nullable(),
  addressLine: z.string().trim().min(5).max(300),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  zoneKey: z.string().min(1),
  paymentMethod: z.enum(['PAYME', 'CLICK', 'COD']),
  comment: z.string().trim().max(500).optional().nullable(),
  offerVersion: z.string().min(1),
  /** Explicit opt-ins captured on checkout (service messages never need consent). */
  consents: z
    .object({ smsMarketing: z.boolean().default(false), telegram: z.boolean().default(false) })
    .default({ smsMarketing: false, telegram: false }),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutNext = { type: 'redirect'; url: string } | { type: 'cod' };

export interface CheckoutResultDto {
  orderNumber: string;
  publicId: string;
  next: CheckoutNext;
}

// ───────── Orders & tracking ─────────

export interface OrderTimelineStepDto {
  key: 'ACCEPTED' | 'PAID' | 'PACKING' | 'SHIPPED' | 'DELIVERED';
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'upcoming';
  note: string | null;
}

export interface OrderItemDto {
  name: string;
  variantLabel: string;
  qty: number;
  lineTotalSoum: number;
  image: ImageDto | null;
}

export interface OrderPublicDto {
  number: string;
  /** Language the customer ordered in (tracking links open in it). */
  locale: Locale;
  publicId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  deliveryStatus: DeliveryStatus;
  carrier: 'YANDEX' | 'BTS' | 'PICKUP';
  contactName: string;
  /** Masked unless the viewer is the authenticated owner. */
  contactPhone: string;
  address: { region: string; district: string | null; line: string };
  items: OrderItemDto[];
  subtotalSoum: number;
  discountSoum: number;
  shippingSoum: number;
  totalSoum: number;
  promoCode: string | null;
  slaDueAt: string | null;
  createdAt: string;
  timeline: OrderTimelineStepDto[];
  trackingUrl: string;
  telegramDeepLink: string | null;
  canRetryPayment: boolean;
  reservationExpiresAt: string | null;
  fiscalReceiptUrl: string | null;
}

export interface TrackingDto extends OrderPublicDto {
  courier: {
    name: string;
    car: string | null;
    plate: string | null;
    etaFrom: string | null;
    etaTo: string | null;
    distanceKm: number | null;
    /**
     * Carrier's forwarded number to call the courier (Yandex: temporary, may need `phoneExt`).
     * Full only for the order owner (signed-in customer or the browser that placed the order),
     * masked otherwise; null when unknown or expired.
     */
    phone: string | null;
    phoneExt: string | null;
  } | null;
  carrierRef: string | null;
  history: { at: string; place: string; note: string; status?: DeliveryStatus }[];
  canChangeAddress: boolean;
}

export const changeAddressSchema = z.object({
  addressLine: z.string().trim().min(5).max(300),
  district: z.string().max(80).optional().nullable(),
});

// ───────── Auth & account ─────────

export const otpSendSchema = z.object({ phone: uzPhoneSchema });
export const otpVerifySchema = z.object({
  phone: uzPhoneSchema,
  code: z.string().regex(/^\d{4}$/),
});

/**
 * Telegram Login Widget payload (`id, first_name, last_name, username, photo_url, auth_date,
 * hash`). Any extra field Telegram adds is kept: every received field except `hash` is part of
 * the signed data-check-string, so dropping unknown ones would break verification.
 */
export const telegramAuthSchema = z
  .record(z.string().regex(/^[a-z_]{1,32}$/), z.union([z.string().max(1024), z.number()]))
  .refine((v) => Object.keys(v).length <= 20, { path: ['hash'] })
  .refine((v) => typeof v.hash === 'string' && /^[0-9a-f]{64}$/.test(v.hash), { path: ['hash'] })
  .refine((v) => /^\d{1,20}$/.test(String(v.id ?? '')), { path: ['id'] })
  .refine((v) => /^\d{1,12}$/.test(String(v.auth_date ?? '')), { path: ['auth_date'] });
export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;

export interface MeDto {
  id: string;
  publicId: string;
  name: string | null;
  /** Null for a customer who signed in with Telegram and never gave a phone. */
  phone: string | null;
  /** Telegram account linked (login widget or bot). */
  telegram: { username: string | null } | null;
  locale: 'uz' | 'ru';
  customerSince: string;
  consents: { smsMarketing: boolean; telegram: boolean; adsMatching: boolean };
  ordersCount: number;
  favoritesCount: number;
  addressesCount: number;
}

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional().nullable(),
  region: z.string().min(1),
  district: z.string().max(80).optional().nullable(),
  line: z.string().trim().min(5).max(300),
  isDefault: z.boolean().default(false),
});

export const consentsSchema = z.object({
  smsMarketing: z.boolean().optional(),
  telegram: z.boolean().optional(),
  adsMatching: z.boolean().optional(),
});

// ───────── Leads & waitlist ─────────

export const LEAD_SOURCES = ['popup', 'selector', 'footer', 'home', 'bot', 'checkout'] as const;
export const leadSchema = z.object({
  phone: uzPhoneSchema,
  source: z.enum(LEAD_SOURCES),
  /** Explicit SMS-marketing opt-in checkbox; absent/false records no consent. */
  marketingConsent: z.boolean().optional(),
});

export const waitlistSchema = z.object({
  variantId: z.string().min(1),
  phone: uzPhoneSchema,
});

// ───────── Calculator ─────────

export const calculatorSchema = z.object({
  productSlug: z.string().min(1),
  areaM2: z.number().positive().max(500),
  coats: z.number().int().min(1).max(5),
});
