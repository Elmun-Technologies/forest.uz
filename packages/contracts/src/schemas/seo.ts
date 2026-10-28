import { z } from 'zod';
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '../admin-catalog-types';
import { REDIRECT_CODES } from '../seo';
import { settingSchemas } from './settings';

/** SEO center (A9) inputs and storefront SEO queries. */

const localeSchema = z.enum(['uz', 'ru']);
/** Locale-less storefront path as stored in `SeoMeta.path`. */
const pagePath = z
  .string()
  .trim()
  .max(512)
  .regex(/^\/[^\s?#\\]*$/, 'path');

export const seoMetaQuerySchema = z.object({ path: pagePath, locale: localeSchema });

export const seoMetaInputSchema = z.object({
  path: pagePath,
  locale: localeSchema,
  title: z.string().trim().max(SEO_TITLE_MAX),
  description: z.string().trim().max(SEO_DESCRIPTION_MAX),
  ogImageId: z.string().max(40).nullable().default(null),
  noindex: z.boolean().default(false),
  /** A same-site path (`/uz/p/x`) or an absolute https URL; blank = self canonical. */
  canonical: z
    .string()
    .trim()
    .max(512)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
});
export type SeoMetaInput = z.infer<typeof seoMetaInputSchema>;

export const seoMetaDeleteSchema = z.object({ path: pagePath, locale: localeSchema });

/** Paths are normalised server-side (query/fragment dropped); `to` may also be our absolute URL. */
export const redirectInputSchema = z.object({
  from: z.string().trim().min(1).max(512),
  to: z.string().trim().min(1).max(512),
  code: z
    .number()
    .int()
    .refine((c) => (REDIRECT_CODES as readonly number[]).includes(c))
    .default(301),
});
export type RedirectInput = z.infer<typeof redirectInputSchema>;

export const redirectListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const notFoundQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const notFoundDismissSchema = z.object({ path: z.string().trim().min(1).max(512) });

export const verificationInputSchema = z.object({
  google: z.string().max(400).nullable().default(null),
  yandex: z.string().max(400).nullable().default(null),
  bing: z.string().max(400).nullable().default(null),
});
export type VerificationInput = z.infer<typeof verificationInputSchema>;

export const robotsInputSchema = z.object({
  /** null or blank = the generated default. */
  custom: z.string().max(10_000).nullable(),
});

export const schemaTogglesInputSchema = settingSchemas['seo.schema'];

export const indexNowInputSchema = z.object({ enabled: z.boolean() });

export const searchQueriesQuerySchema = z.object({
  source: z.enum(['gsc', 'ywm']).default('gsc'),
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 28, 90].includes(d))
    .default(28),
});

export const pageSpeedRunInputSchema = z.object({
  /** Locale-prefixed storefront path, e.g. `/uz/p/chalk-white`. */
  path: z
    .string()
    .trim()
    .max(512)
    .regex(/^\/[^\s?#\\]*$/),
  strategy: z.enum(['mobile', 'desktop']).default('mobile'),
});
