import { z } from 'zod';
import { CUSTOMER_SEGMENTS, CUSTOMER_SORTS } from '../admin-customers';

/** Admin A4/A5 inputs (`/v1/admin/customers`). DTOs live in the zod-free `admin-customers.ts`. */

/** URL params arrive as '' when a filter is cleared: treat blank as "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalSoum = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
);

export const customerFiltersSchema = z.object({
  segment: z.enum(CUSTOMER_SEGMENTS).catch('all').default('all'),
  /** Name, phone digits, order number (F-10482 / 10482) or customer id (C-10001). */
  q: optionalText(80),
  region: optionalText(40),
  source: optionalText(80),
  productId: optionalText(64),
  ltvMin: optionalSoum,
  ltvMax: optionalSoum,
});
export type CustomerFilters = z.infer<typeof customerFiltersSchema>;

export const customerListQuerySchema = customerFiltersSchema.extend({
  sort: z.enum(CUSTOMER_SORTS).catch('activity').default('activity'),
  cursor: optionalText(200),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerExportSchema = customerFiltersSchema.extend({
  /** Full phone numbers in the file (audited as such); masked otherwise. */
  reveal: z.boolean().default(false),
});
export type CustomerExportInput = z.infer<typeof customerExportSchema>;

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^#/, ''))
  .pipe(z.string().regex(/^[\p{L}\p{N}_'-]{1,32}$/u));

export const customerTagsSchema = z.object({
  tags: z
    .array(tag)
    .max(20)
    .transform((v) => [...new Set(v)]),
});
export type CustomerTagsInput = z.infer<typeof customerTagsSchema>;

export const customerNoteSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export type CustomerNoteInput = z.infer<typeof customerNoteSchema>;

/** Typed confirmation: the customer's `C-…` id. */
export const customerEraseSchema = z.object({ confirm: z.string().trim().max(32) });
export type CustomerEraseInput = z.infer<typeof customerEraseSchema>;
