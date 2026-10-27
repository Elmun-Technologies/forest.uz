import { z } from 'zod';
import {
  PRODUCT_BADGES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  RELATION_KINDS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from '../admin-catalog-types';
import { SURFACES } from '../catalog';

/** Admin A11 inputs (`/v1/admin/products/*`). Money is integer so'm; services convert to tiyin. */

const text = (max: number) => z.string().trim().max(max);
const localized = (max: number) => z.object({ uz: text(max), ru: text(max) });
const localizedRequired = (max: number) => z.object({ uz: text(max).min(1), ru: text(max).min(1) });
const blankToNull = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => null), schema]).nullable();

export const productSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{1,47}$/);

/** 17 digits; blank → null (allowed only while the product is not ACTIVE). */
export const ikpuInputSchema = blankToNull(
  z
    .string()
    .trim()
    .regex(/^\d{17}$/),
);

const soum = z.number().int().min(0).max(1_000_000_000);

export const adminProductListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(96).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

export const productCreateSchema = z.object({
  name: localizedRequired(160),
  /** Blank → derived from the Uzbek name with the shared `slugify`. */
  slug: z.union([z.literal(''), productSlugSchema]).optional(),
  type: z.enum(PRODUCT_TYPES).default('SIMPLE'),
  categoryIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

const seoLocale = z.object({
  title: text(SEO_TITLE_MAX),
  description: text(SEO_DESCRIPTION_MAX),
});

export const productUpdateSchema = z
  .object({
    name: localizedRequired(160),
    slug: productSlugSchema,
    status: z.enum(PRODUCT_STATUSES),
    subtitle: localized(160).nullable(),
    shortDesc: localized(400),
    description: localized(8000),
    howToApply: localized(4000),
    specs: z.array(z.object({ key: localizedRequired(80), value: localizedRequired(200) })).max(30),
    badges: z.array(z.enum(PRODUCT_BADGES)).max(3),
    surfaces: z.array(z.enum(SURFACES)).max(SURFACES.length),
    // https only: rendered as a link/embed on the storefront.
    videoUrl: blankToNull(z.url({ protocol: /^https$/ }).max(500)),
    coverageM2PerL: z.number().positive().max(999).nullable(),
    dryTimeMinutes: z.number().int().positive().max(100_000).nullable(),
    isBestseller: z.boolean(),
    bestsellerSort: z.number().int().min(0).max(999).nullable(),
    categoryIds: z.array(z.string().min(1).max(64)).max(10),
    keywords: z.array(text(60).min(1)).max(40),
    seo: z.object({ uz: seoLocale, ru: seoLocale }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['name'] });
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

const variantFields = {
  sku: skuSchema,
  label: localizedRequired(60),
  colorHex: blankToNull(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  volumeMl: z.number().int().positive().max(1_000_000).nullable(),
  priceSoum: soum,
  compareAtSoum: soum.nullable(),
  ikpu: ikpuInputSchema,
  packageCode: blankToNull(text(40)),
  vatPercent: z.number().int().min(0).max(100),
  barcode: blankToNull(text(64)),
  weightGrams: z.number().int().positive().max(1_000_000).nullable(),
  stock: z.number().int().min(0).max(10_000_000),
  lowStockAt: z.number().int().min(0).max(100_000),
  active: z.boolean(),
};

export const variantCreateSchema = z.object({
  ...variantFields,
  colorHex: variantFields.colorHex.default(null),
  volumeMl: variantFields.volumeMl.default(null),
  compareAtSoum: variantFields.compareAtSoum.default(null),
  ikpu: variantFields.ikpu.default(null),
  packageCode: variantFields.packageCode.default(null),
  vatPercent: variantFields.vatPercent.default(12),
  barcode: variantFields.barcode.default(null),
  weightGrams: variantFields.weightGrams.default(null),
  stock: variantFields.stock.default(0),
  lowStockAt: variantFields.lowStockAt.optional(),
  active: variantFields.active.default(true),
});
export type VariantCreateInput = z.infer<typeof variantCreateSchema>;

export const variantUpdateSchema = z
  .object(variantFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['sku'] });
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;

/** Full new order of a product's variants or images (every id exactly once). */
export const idOrderSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
});
export type IdOrderInput = z.infer<typeof idOrderSchema>;

export const imageAltSchema = z.object({ alt: localized(200) });
export type ImageAltInput = z.infer<typeof imageAltSchema>;

export const productRelationsSchema = z.object({
  kind: z.enum(RELATION_KINDS),
  productIds: z.array(z.string().min(1).max(64)).max(12),
});
export type ProductRelationsInput = z.infer<typeof productRelationsSchema>;
