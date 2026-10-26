import { z } from 'zod';
import { CARRIERS } from '../delivery';

/**
 * Delivery promise rule for a zone. All values come from settings (admin A16), never code.
 * - `promiseHours`: SLA window after the clock starts (payment confirmed / COD operator-confirmed).
 * - `cutoff`: if the clock starts at/after this local time, the promise becomes `afterCutoffBy` next working day.
 * - `sameDayEnd`: before cut-off the promise is capped to this local time of the same day.
 * - `workDays`: weekdays the carrier works (0 = Sunday). Non-working days roll to the next working day.
 */
export const deliveryRuleSchema = z.object({
  promiseHours: z.number().int().positive(),
  cutoff: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  sameDayEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  afterCutoffBy: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
});

export const deliveryZoneSchema = z.object({
  key: z.string().min(1),
  name: z.object({ uz: z.string(), ru: z.string() }),
  carrier: z.enum(CARRIERS),
  /** Region codes (see regions list) served by this zone; empty = fallback zone. */
  regions: z.array(z.string()),
  /** Optional district restriction inside regions (e.g. Tashkent city districts). */
  districts: z.array(z.string()).optional(),
  priceSoum: z.number().int().nonnegative(),
  freeFromSoum: z.number().int().positive().nullable(),
  etaLabel: z.object({ uz: z.string(), ru: z.string() }),
  rule: deliveryRuleSchema,
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
