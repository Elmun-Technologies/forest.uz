import { z } from 'zod';
import { ARTICLE_CATEGORIES, CMS_LIMITS } from '../cms';
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '../admin-catalog-types';
import { contentBlockSchema } from './content';

/** Ilhom/Brend CMS inputs (admin) and storefront list query (CLAUDE.md §6). */

export const cmsSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const text = (max: number) => z.string().trim().max(max);

const localeContent = z.object({
  title: text(CMS_LIMITS.title),
  excerpt: text(CMS_LIMITS.excerpt).default(''),
  blocks: z.array(contentBlockSchema).max(CMS_LIMITS.blocks).default([]),
  published: z.boolean().default(false),
  seoTitle: text(SEO_TITLE_MAX).default(''),
  seoDescription: text(SEO_DESCRIPTION_MAX).default(''),
});
export type CmsLocaleInput = z.infer<typeof localeContent>;

const httpsUrl = z.url({ protocol: /^https$/ }).max(500);

/** Whole-document save (both locales), like the settings documents. */
export const articleSaveSchema = z
  .object({
    slug: cmsSlugSchema,
    category: z.enum(ARTICLE_CATEGORIES).nullable().default(null),
    coverId: z.string().min(1).max(64).nullable().default(null),
    videoUrl: z
      .union([z.literal('').transform(() => null), httpsUrl])
      .nullable()
      .default(null),
    videoMinutes: z.number().int().min(1).max(600).nullable().default(null),
    readingMinutes: z.number().int().min(1).max(120).nullable().default(null),
    sort: z.number().int().min(0).max(100_000).default(0),
    relatedProductIds: z
      .array(z.string().min(1).max(64))
      .max(CMS_LIMITS.relatedProducts)
      .default([]),
    uz: localeContent,
    ru: localeContent,
  })
  .superRefine((v, ctx) => {
    for (const l of ['uz', 'ru'] as const) {
      if (v[l].published && !v[l].title)
        ctx.addIssue({ code: 'custom', path: [l, 'title'], message: 'VALIDATION_FAILED' });
    }
  });
export type ArticleSaveInput = z.infer<typeof articleSaveSchema>;

export const articleDeleteSchema = z.object({ confirm: z.string().trim().max(96) });
export type ArticleDeleteInput = z.infer<typeof articleDeleteSchema>;

export const articleListQuerySchema = z.object({
  category: z.enum(ARTICLE_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;

/** Stored `Page.data` of ARTICLE/PAGE rows (same object on both locale rows). */
export const articleDataSchema = z
  .object({
    excerpt: z.string().optional(),
    category: z.enum(ARTICLE_CATEGORIES).nullable().optional(),
    videoUrl: z.string().nullable().optional(),
    videoMinutes: z.number().nullable().optional(),
    readingMinutes: z.number().nullable().optional(),
    sort: z.number().optional(),
    relatedProductIds: z.array(z.string()).optional(),
    publishedAt: z.string().nullable().optional(),
  })
  .passthrough();
export type ArticleData = z.infer<typeof articleDataSchema>;
