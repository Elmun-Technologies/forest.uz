import { z } from 'zod';
import { localeSchema } from './locale';

/**
 * Customer-facing inputs/DTOs that are not part of cart/checkout: account (/me), search,
 * SEO feeds. Shapes consumed by web live next to the related ones in storefront.ts.
 */

// ───────── /me ─────────

export const meUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).nullable().optional(),
    locale: localeSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.locale !== undefined, { path: ['name'] });
export type MeUpdateInput = z.infer<typeof meUpdateSchema>;

/** PATCH semantics: only provided fields change (no defaults, unlike `addressSchema`). */
export const addressUpdateSchema = z
  .object({
    label: z.string().trim().max(40).nullable(),
    region: z.string().min(1),
    district: z.string().max(80).nullable(),
    line: z.string().trim().min(5).max(300),
    isDefault: z.boolean(),
  })
  .partial();
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

export interface AddressDto {
  id: string;
  label: string | null;
  region: string;
  district: string | null;
  line: string;
  isDefault: boolean;
}

export const favoriteSchema = z.object({ productId: z.string().min(1).max(64) });

export interface ConsentsDto {
  smsMarketing: boolean;
  telegram: boolean;
  adsMatching: boolean;
}

export interface DataDeleteRequestDto {
  requestedAt: string;
  /** Request is processed within `store.info.deletionSlaDays`. */
  dueBy: string;
}

// ───────── Search ─────────

export const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(24).default(8),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ───────── SEO ─────────

export interface SitemapDataDto {
  products: { slug: string; updatedAt: string }[];
  categories: { slug: string; updatedAt: string | null }[];
  pages: { kind: string; slug: string; locales: ('uz' | 'ru')[]; updatedAt: string }[];
}

export const redirectQuerySchema = z.object({ path: z.string().min(1).max(2048) });

export interface RedirectDto {
  to: string;
  code: number;
}

export const notFoundReportSchema = z.object({
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).optional().nullable(),
});
