import { productSeoTitle, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from './admin-catalog-types';
import type { Locale } from './locale';

/**
 * SEO center (A9, docs/10) — zod-free: page templates, limits, DTOs. The storefront renders the
 * same templates from its messages; `seo.test.ts` keeps both in step.
 */

export const SEO_TITLE_MIN = 30;
export const SEO_DESCRIPTION_MIN = 70;
export { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX };

export type SeoPageKind = 'home' | 'catalog' | 'category' | 'product' | 'legal' | 'article';

export const SEO_SCHEMA_KEYS = [
  'product',
  'organization',
  'breadcrumb',
  'faq',
  'howTo',
  'video',
] as const;
export type SeoSchemaKey = (typeof SEO_SCHEMA_KEYS)[number];
export type SeoSchemaToggles = Record<SeoSchemaKey, boolean>;

/** Values a page template needs (each kind uses its own subset). */
export interface SeoTemplateVars {
  name?: string;
  /** Products in a category (category description). */
  count?: number;
  /** Product short description / category SEO text / legal subtitle. */
  text?: string | null;
}

const T = {
  uz: {
    homeTitle: 'Forest — eski mebel yangidek bir kunda',
    homeDescription:
      "Mebel va divanni yangilash uchun Yevropa bo'yoqlari va aksessuarlari. Toshkent bo'ylab 12 soatda, O'zbekiston bo'ylab 24 soatda yetkazish.",
    catalogTitle: "Katalog: mebel va mato uchun bo'yoqlar",
    catalogDescription:
      "Mebel, divan va mato uchun Yevropa bo'yoqlari, mum, cho'tka va tayyor to'plamlar. Toshkentda 12 soatda, viloyatlarga 24 soatda yetkazish.",
    categoryTitle: (name: string) => `${name} — narxlari, sotib olish`,
    categoryDescription: (name: string, count: number) =>
      `${name}: Yevropa bo'yoqlari va aksessuarlari. ${count} ta mahsulot. Toshkentda 12 soatda, viloyatlarga 24 soatda yetkazish. Payme, Click yoki naqd.`,
    productTail: "Toshkentda 12 soatda yetkazish, Payme, Click yoki naqd to'lov.",
  },
  ru: {
    homeTitle: 'Forest — старая мебель как новая за один день',
    homeDescription:
      'Европейские краски и аксессуары для обновления мебели и диванов. Доставка по Ташкенту за 12 часов, по Узбекистану — за 24 часа.',
    catalogTitle: 'Каталог: краски для мебели и ткани',
    catalogDescription:
      'Европейские краски для мебели, диванов и ткани, воск, кисти и готовые наборы. Доставка по Ташкенту за 12 часов, в регионы — за 24 часа.',
    categoryTitle: (name: string) => `${name} — цены, купить`,
    categoryDescription: (name: string, count: number) =>
      `${name}: европейские краски и аксессуары, ${count} ${ruGoods(count)}. Доставка по Ташкенту за 12 часов, в регионы — за 24 часа. Payme, Click или наличными.`,
    productTail: 'Доставка по Ташкенту за 12 часов, оплата Payme, Click или наличными.',
  },
} as const;

function ruGoods(n: number): string {
  const rule = new Intl.PluralRules('ru').select(n);
  return rule === 'one' ? 'товар' : rule === 'few' ? 'товара' : 'товаров';
}

/** Layout title template `%s | Forest` (storefront `[locale]/layout.tsx`). */
export const withSiteName = (title: string) => `${title} | Forest`;

/** Same trimming as the storefront (`lib/seo.ts` metaDescription): ≤ 160 chars on a word. */
export function trimMetaDescription(text: string, max = SEO_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * docs/10 defaults: the full title (as rendered in `<title>`) and description the storefront uses
 * when no override exists.
 */
export function seoTemplate(
  kind: SeoPageKind,
  locale: Locale,
  vars: SeoTemplateVars = {},
): { title: string; description: string } {
  const t = T[locale];
  const name = vars.name ?? '';
  switch (kind) {
    case 'home':
      return { title: t.homeTitle, description: t.homeDescription };
    case 'catalog':
      return { title: withSiteName(t.catalogTitle), description: t.catalogDescription };
    case 'category':
      return {
        title: withSiteName(t.categoryTitle(name)),
        description: trimMetaDescription(vars.text || t.categoryDescription(name, vars.count ?? 0)),
      };
    case 'product':
      return {
        title: productSeoTitle(name, locale),
        description: trimMetaDescription(`${vars.text ?? ''} ${t.productTail}`),
      };
    case 'legal':
      return {
        title: withSiteName(name),
        description: trimMetaDescription(`Forest: ${name}. ${vars.text ?? ''}.`),
      };
    // Ilhom articles and the Brend page (CMS): the excerpt, else the title.
    case 'article':
      return {
        title: withSiteName(name),
        description: trimMetaDescription(vars.text || `Forest: ${name}.`),
      };
  }
}

/** SERP-like cut (Google shows ~60 title / ~160 description characters). */
export function serpCut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Verification inputs accept the bare code or the whole `<meta … content="…">` tag Google, Yandex
 * and Bing show. Returns the code, null for blank, or `false` when it can't be a code.
 */
export function parseVerificationCode(input: string | null | undefined): string | null | false {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const tag = /content\s*=\s*["']([^"']*)["']/i.exec(raw);
  const code = (tag ? tag[1] : raw)!.trim();
  return /^[A-Za-z0-9_\-:.=+/]{4,200}$/.test(code) ? code : false;
}

// ───────────────────────── Storefront DTOs ─────────────────────────

/** `GET /v1/seo/meta?path=&locale=` — the admin override for one page (null = template). */
export interface SeoMetaPublicDto {
  meta: {
    title: string | null;
    description: string | null;
    ogImage: { url: string; width: number | null; height: number | null } | null;
    noindex: boolean;
    /** Absolute URL or a same-site path; null = self canonical. */
    canonical: string | null;
  } | null;
}

/** `GET /v1/seo/public` — site-wide SEO switches for the storefront. */
export interface SeoPublicConfigDto {
  schema: SeoSchemaToggles;
}

// ───────────────────────── Admin A9 DTOs ─────────────────────────

export type SeoSeverity = 'critical' | 'warning';
export const SEO_RULES = [
  'title_missing',
  'description_missing',
  'noindex_in_sitemap',
  'canonical_foreign',
  'broken_link',
  'cwv_poor',
  'title_duplicate',
  'description_duplicate',
  'title_length',
  'description_length',
  'alt_missing',
  'cwv_needs_improvement',
] as const;
export type SeoRule = (typeof SEO_RULES)[number];

export interface SeoIssueDto {
  rule: SeoRule;
  severity: SeoSeverity;
  /** Affected pages (or links / metrics for site-wide rules). */
  count: number;
  examples: { path: string; locale: Locale | null; detail: string | null }[];
}

export interface AdminSeoHealthDto {
  score: number;
  critical: number;
  warnings: number;
  pages: number;
  issues: SeoIssueDto[];
}

export interface AdminSeoOverrideDto {
  title: string;
  description: string;
  ogImageId: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  canonical: string | null;
  updatedAt: string;
}

export interface AdminSeoPageDto {
  /** Locale-less storefront path (`/`, `/katalog`, `/p/<slug>`…). */
  path: string;
  kind: SeoPageKind;
  locale: Locale;
  label: string;
  url: string;
  template: { title: string; description: string };
  override: AdminSeoOverrideDto | null;
  effective: { title: string; description: string; noindex: boolean; canonical: string };
  /** Product rich-result inputs (price / stock / rating from approved reviews). */
  rich: {
    priceFromSoum: number;
    inStock: boolean;
    rating: { average: number; count: number } | null;
  } | null;
  imagesWithoutAlt: number;
  /** Product images usable as OG image (product pages only). */
  images: { fileId: string; url: string }[];
  issues: { rule: SeoRule; severity: SeoSeverity }[];
}

export interface AdminSeoPagesDto {
  siteUrl: string;
  items: AdminSeoPageDto[];
}

export interface SeoSourceStateDto {
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastSyncedAt: string | null;
}

export interface AdminSeoOverviewDto {
  siteUrl: string;
  usingFake: boolean;
  health: AdminSeoHealthDto;
  verification: { google: string | null; yandex: string | null; bing: string | null };
  robots: { custom: string | null; effective: string; defaultText: string };
  schema: SeoSchemaToggles;
  /** Pages that render FAQPage (home FAQ items). */
  faqPages: number;
  sitemap: {
    url: string;
    generatedAt: string | null;
    urls: number;
    reason: string | null;
    files: { name: string; urls: number }[];
  };
  indexNow: {
    enabled: boolean;
    keyFileUrl: string;
    /** false = APP_URL is not a public https host: pings are skipped. */
    publicHost: boolean;
    pending: number;
    lastPing: { at: string; ok: boolean; message: string } | null;
  };
  redirects: number;
  notFound7d: { paths: number; hits: number };
  sources: { gsc: SeoSourceStateDto; ywm: SeoSourceStateDto; pagespeed: SeoSourceStateDto };
}

export interface AdminSearchQueryRowDto {
  query: string;
  clicks: number;
  impressions: number;
  /** clicks / impressions, 0..1. */
  ctr: number;
  /** Impression-weighted average position; null when unknown. */
  position: number | null;
}

export interface AdminSearchTotalsDto {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface AdminSearchQueriesDto {
  source: 'gsc' | 'ywm';
  status: SeoSourceStateDto['status'];
  days: number;
  lastSyncedAt: string | null;
  totals: AdminSearchTotalsDto;
  previous: AdminSearchTotalsDto | null;
  items: AdminSearchQueryRowDto[];
}

export type CwvMetric = 'LCP' | 'INP' | 'CLS';
export type CwvRating = 'good' | 'needs-improvement' | 'poor';

/** web.dev thresholds (good ≤ first, poor > second). LCP/INP in ms. */
export const CWV_THRESHOLDS: Record<CwvMetric, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
};

export function cwvRating(metric: CwvMetric, value: number): CwvRating {
  const [good, poor] = CWV_THRESHOLDS[metric];
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-improvement';
}

export interface PageSpeedRunDto {
  id: string;
  url: string;
  strategy: 'mobile' | 'desktop';
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  createdAt: string;
}

export interface AdminCwvDto {
  /** `mobile` when the tracker reports viewport widths, else every device. */
  scope: 'mobile' | 'all';
  days: number;
  metrics: { metric: CwvMetric; p75: number | null; rating: CwvRating | null; samples: number }[];
  pages: {
    path: string;
    samples: number;
    LCP: number | null;
    INP: number | null;
    CLS: number | null;
  }[];
  lab: PageSpeedRunDto[];
}

export const REDIRECT_CODES = [301, 302, 307, 308] as const;

export interface AdminRedirectDto {
  id: string;
  from: string;
  to: string;
  code: number;
  hits: number;
  lastHitAt: string | null;
  createdAt: string;
}

export interface AdminRedirectPageDto {
  items: AdminRedirectDto[];
  nextCursor: string | null;
  total: number;
}

export interface AdminNotFoundDto {
  path: string;
  hits: number;
  lastSeen: string;
  referrer: string | null;
  /** Referred by our own site = a broken internal link. */
  internal: boolean;
  /** Closest live path (create-redirect suggestion). */
  suggestion: string | null;
}

export interface AdminZeroResultDto {
  query: string;
  locale: Locale;
  searches: number;
  lastAt: string;
}
