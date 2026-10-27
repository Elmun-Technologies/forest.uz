/**
 * Ilhom (articles) & Brend CMS (CLAUDE.md §6). Zod-free DTOs + constants for web and admin; the
 * stored block format is `contentBlockSchema` (schemas/content.ts), inputs in `schemas/cms.ts`.
 */

import type { Locale } from './locale';

/** Ilhom chips (design: Hammasi, Mebel, Divan va mato, Video darslar, Rang tanlash). */
export const ARTICLE_CATEGORIES = ['furniture', 'fabric', 'video', 'colors'] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export function isArticleCategory(value: unknown): value is ArticleCategory {
  return typeof value === 'string' && (ARTICLE_CATEGORIES as readonly string[]).includes(value);
}

/** Page kinds the 5C CMS owns (legal/FAQ/home blocks stay with the seed). */
export const CMS_ARTICLE_KIND = 'ARTICLE';
export const CMS_PAGE_KIND = 'PAGE';
/** The brand story page (`PAGE/brend`). */
export const BRAND_PAGE_SLUG = 'brend';

export const CMS_LIMITS = {
  title: 120,
  excerpt: 300,
  blocks: 200,
  text: 5000,
  relatedProducts: 8,
  listPageSize: 24,
} as const;

/** Storefront article path (locale-less). */
export const articlePath = (slug: string) => `/ilhom/${slug}`;

// ───────────────────────── Public DTOs ─────────────────────────

export interface CmsImageDto {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Rendered blocks: the stored ones with images resolved to URLs. */
export type ArticleBlockDto =
  | { type: 'h2' | 'h3' | 'p'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'dl'; items: { term: string; desc: string }[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'note'; tone: 'info' | 'warn'; text: string }
  | { type: 'faq'; items: { q: string; a: string }[] }
  | { type: 'quote'; text: string; cite: string | null }
  | { type: 'image'; image: CmsImageDto; caption: string | null };

export interface ArticleCardDto {
  slug: string;
  title: string;
  excerpt: string | null;
  category: ArticleCategory | null;
  cover: CmsImageDto | null;
  readingMinutes: number | null;
  /** Video lessons: duration label shown on the card. */
  videoMinutes: number | null;
  hasVideo: boolean;
  publishedAt: string | null;
}

export interface ArticleListDto {
  items: ArticleCardDto[];
  /** Categories that have at least one published article (chips without content are hidden). */
  categories: ArticleCategory[];
  page: number;
  pages: number;
  total: number;
}

export interface ArticleRelatedProductDto {
  slug: string;
  name: string;
  image: CmsImageDto | null;
  priceFromUzs: number;
  inStock: boolean;
}

export interface ArticleDto extends ArticleCardDto {
  locale: Locale;
  /** Locales this article is published in (hreflang). */
  locales: Locale[];
  videoUrl: string | null;
  blocks: ArticleBlockDto[];
  related: ArticleRelatedProductDto[];
  updatedAt: string;
}

export interface BrandStoryDto {
  title: string;
  excerpt: string | null;
  cover: CmsImageDto | null;
  blocks: ArticleBlockDto[];
  updatedAt: string;
}

// ───────────────────────── Admin DTOs ─────────────────────────

export interface AdminPageLocaleDto {
  locale: Locale;
  exists: boolean;
  published: boolean;
  title: string;
  excerpt: string;
  /** Stored blocks (contentBlockSchema). */
  blocks: unknown[];
  seoTitle: string;
  seoDescription: string;
  updatedAt: string | null;
}

export interface AdminArticleDto {
  kind: 'ARTICLE' | 'PAGE';
  slug: string;
  category: ArticleCategory | null;
  cover: { fileId: string; url: string; width: number | null; height: number | null } | null;
  videoUrl: string | null;
  videoMinutes: number | null;
  readingMinutes: number | null;
  sort: number;
  relatedProductIds: string[];
  publishedAt: string | null;
  locales: Record<Locale, AdminPageLocaleDto>;
  /** Images referenced by blocks, id → url (editor previews). */
  files: Record<string, string>;
}

export interface AdminArticleRowDto {
  kind: 'ARTICLE' | 'PAGE';
  slug: string;
  title: string;
  category: ArticleCategory | null;
  published: Record<Locale, boolean>;
  hasCover: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface AdminArticleListDto {
  items: AdminArticleRowDto[];
}

export interface AdminUploadedImageDto {
  fileId: string;
  url: string;
  width: number | null;
  height: number | null;
}
