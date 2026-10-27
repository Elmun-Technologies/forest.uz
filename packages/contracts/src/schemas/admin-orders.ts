import { z } from 'zod';
import {
  ADMIN_ORDER_SORTS,
  ADMIN_ORDER_SOURCES,
  ADMIN_ORDER_TABS,
  ADMIN_PAYMENT_FILTERS,
} from '../admin-orders';
import { CARRIERS } from '../delivery';
import { LOCALES } from '../locale';
import { DELIVERY_STATUSES, PAYMENT_METHODS } from '../order-state';
import { uzPhoneSchema } from './common';

/** Admin orders inputs (`/v1/admin/orders/*`). DTOs live in the zod-free `admin-orders.ts`. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Empty query values (`?carrier=`) mean "no filter". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const adminOrderFilterSchema = z.object({
  tab: optional(z.enum(ADMIN_ORDER_TABS)).default('all'),
  q: optional(z.string().trim().max(80)),
  paymentMethod: optional(z.enum(PAYMENT_METHODS)),
  payment: optional(z.enum(ADMIN_PAYMENT_FILTERS)),
  carrier: optional(z.enum(CARRIERS)),
  source: optional(z.enum(ADMIN_ORDER_SOURCES)),
  from: optional(isoDate),
  to: optional(isoDate),
  sort: optional(z.enum(ADMIN_ORDER_SORTS)).default('created_desc'),
});
export type AdminOrderFilter = z.infer<typeof adminOrderFilterSchema>;

export const adminOrderQuerySchema = adminOrderFilterSchema.extend({
  cursor: optional(z.string().max(300)),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

const reason = z.string().trim().min(3).max(300);

export const adminOrderCancelSchema = z.object({ reason });
export type AdminOrderCancelInput = z.infer<typeof adminOrderCancelSchema>;

export const adminOrderRefundSchema = z.object({
  paymentId: z.string().min(1).max(40),
  amountSoum: z.number().int().positive().max(1_000_000_000),
  reason,
});
export type AdminOrderRefundInput = z.infer<typeof adminOrderRefundSchema>;

export const adminOrderNoteSchema = z.object({ text: z.string().trim().min(1).max(1000) });
export type AdminOrderNoteInput = z.infer<typeof adminOrderNoteSchema>;

export const adminOrderReceiptSchema = z
  .object({
    receiptNumber: z.string().trim().max(64).optional().nullable(),
    // https only: the link is rendered for staff and customers (no javascript:/data: URLs).
    receiptUrl: z
      .union([z.literal('').transform(() => null), z.url({ protocol: /^https$/ }).max(500)])
      .optional()
      .nullable(),
  })
  .refine((v) => Boolean(v.receiptNumber || v.receiptUrl), { path: ['receiptNumber'] });
export type AdminOrderReceiptInput = z.infer<typeof adminOrderReceiptSchema>;

export const adminBtsUpdateSchema = z.object({
  status: z.enum(DELIVERY_STATUSES).exclude(['NOT_CREATED']),
  trackNumber: z.string().trim().max(40).optional().nullable(),
  branch: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});
export type AdminBtsUpdateInput = z.infer<typeof adminBtsUpdateSchema>;

export const adminClaimCancelSchema = z.object({ allowPaid: z.boolean().default(false) });
export type AdminClaimCancelInput = z.infer<typeof adminClaimCancelSchema>;

export const adminVariantSearchSchema = z.object({ q: z.string().trim().max(80).default('') });

/** Phone order (A6 "+ Qo'lda buyurtma"): COD only, lines priced server-side. */
export const adminManualOrderSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: uzPhoneSchema,
  region: z.string().min(1).max(40),
  district: z.string().max(80).optional().nullable(),
  addressLine: z.string().trim().min(5).max(300),
  zoneKey: z.string().min(1).max(60),
  comment: z.string().trim().max(500).optional().nullable(),
  /** Language of the customer's SMS. */
  locale: z.enum(LOCALES).default('uz'),
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(40), qty: z.number().int().min(1).max(99) }))
    .min(1)
    .max(30)
    .refine((l) => new Set(l.map((x) => x.variantId)).size === l.length, { path: ['lines'] }),
});
export type AdminManualOrderInput = z.infer<typeof adminManualOrderSchema>;
