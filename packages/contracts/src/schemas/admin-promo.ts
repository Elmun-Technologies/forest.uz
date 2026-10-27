import { z } from 'zod';
import { PROMO_AUDIENCES } from '../admin-catalog-types';
import { PROMO_TYPES } from '../pricing';

/**
 * Admin A14 inputs (`/v1/admin/promo/*`). Shape only — the margin guard, gift and date rules need
 * settings and the stored row, so `AdminPromoService` checks the merged record.
 */

const nullableDate = z
  .union([z.literal('').transform(() => null), z.iso.datetime({ offset: true })])
  .nullable()
  .transform((v) => (v ? new Date(v) : null));

const promoFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/),
  type: z.enum(PROMO_TYPES),
  /** PERCENT: percent; FIXED: so'm; FREE_SHIPPING/GIFT: ignored (stored as 0). */
  value: z.number().int().min(0).max(100_000_000),
  giftVariantId: z.string().min(1).max(64).nullable(),
  minCartSoum: z.number().int().min(0).max(1_000_000_000),
  audience: z.enum(PROMO_AUDIENCES),
  segmentId: z.string().min(1).max(64).nullable(),
  usageLimit: z.number().int().positive().max(10_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1).max(1000),
  startsAt: nullableDate,
  endsAt: nullableDate,
  utmSource: z.union([z.literal('').transform(() => null), z.string().trim().max(64)]).nullable(),
  active: z.boolean(),
};

export const promoCreateSchema = z.object({
  ...promoFields,
  value: promoFields.value.default(0),
  giftVariantId: promoFields.giftVariantId.default(null),
  minCartSoum: promoFields.minCartSoum.default(0),
  audience: promoFields.audience.default('ALL'),
  segmentId: promoFields.segmentId.default(null),
  usageLimit: promoFields.usageLimit.default(null),
  perCustomerLimit: promoFields.perCustomerLimit.default(1),
  startsAt: promoFields.startsAt.default(null),
  endsAt: promoFields.endsAt.default(null),
  utmSource: promoFields.utmSource.default(null),
  active: promoFields.active.default(true),
});
export type PromoCreateInput = z.infer<typeof promoCreateSchema>;

export const promoUpdateSchema = z
  .object(promoFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['code'] });
export type PromoUpdateInput = z.infer<typeof promoUpdateSchema>;

export const adminPromoListQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  state: z.enum(['active', 'scheduled', 'expired', 'paused', 'exhausted']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminPromoListQuery = z.infer<typeof adminPromoListQuerySchema>;
