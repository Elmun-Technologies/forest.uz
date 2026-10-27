/**
 * Admin catalog (A11 products, A14 promo, A15 reviews): zod-free constants, pure rules and DTOs,
 * exported from `/core` for the admin UI. Inputs (zod) live in `schemas/admin-catalog.ts`,
 * `schemas/admin-promo.ts`, `schemas/admin-reviews.ts`. Money in DTOs is integer so'm.
 */
import type { PromoType } from './pricing';

export interface LocalizedText {
  uz: string;
  ru: string;
}

/**
 * Where the catalog comes from (CLAUDE.md §6): 'moysklad' when the integration is connected with
 * its products flow on (variant list read-only); price/stock locks follow their own sync flows.
 */
export type CatalogSource = 'moysklad' | 'local';

export interface CatalogLocksDto {
  source: CatalogSource;
  /** Price and compare-at are synced from MoySklad (read-only in admin). */
  price: boolean;
  /** Stock is synced from MoySklad (read-only in admin). */
  stock: boolean;
}

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_TYPES = ['SIMPLE', 'BUNDLE'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Storefront card badges (web `card.badges.*`). */
export const PRODUCT_BADGES = ['HIT', 'NEW', 'SALE'] as const;
export type ProductBadge = (typeof PRODUCT_BADGES)[number];

export const RELATION_KINDS = ['CROSS_SELL', 'UPSELL', 'ALTERNATIVE'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Seed placeholder (docs/04): flagged as missing, never sent to a fiscal receipt. */
export const IKPU_PLACEHOLDER = '00000000000000000';

/** IKPU (MXIK) is exactly 17 digits; empty or the placeholder counts as missing. */
export function isValidIkpu(value: string | null | undefined): boolean {
  return !!value && /^\d{17}$/.test(value) && value !== IKPU_PLACEHOLDER;
}

/** docs/10 SEO limits (SERP preview and validation). */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

/** docs/10 product title template (used when the admin leaves the title blank). */
export function productSeoTitle(name: string, locale: 'uz' | 'ru'): string {
  return locale === 'ru'
    ? `${name} — цена, купить | Forest`
    : `${name} — narxi, sotib olish | Forest`;
}

export const ADMIN_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// ───────────────────────── Products (A11) ─────────────────────────

export interface AdminProductKpisDto {
  activeProducts: number;
  /** Active variants of active products. */
  activeVariants: number;
  /** Active variants of active products with available ≤ their low-stock threshold. */
  lowStockVariants: number;
  /** Active variants of non-archived products without a valid IKPU. */
  missingIkpuVariants: number;
}

export interface AdminCategoryOptionDto {
  id: string;
  slug: string;
  name: LocalizedText;
}

export interface AdminProductsMetaDto {
  kpis: AdminProductKpisDto;
  categories: AdminCategoryOptionDto[];
  locks: CatalogLocksDto;
  /** When the MoySklad integration last checked in (null when never / not connected). */
  sourceCheckedAt: string | null;
  seller: { name: string; isOfficial: boolean };
  lowStockDefault: number;
}

export interface AdminProductRowDto {
  id: string;
  slug: string;
  name: LocalizedText;
  type: ProductType;
  status: ProductStatus;
  image: { url: string; alt: string } | null;
  /** Shared SKU prefix of the variants (design "FR-CW"), else the first SKU. */
  sku: string;
  variantCount: number;
  priceFromSoum: number | null;
  /** True when active variants have different prices ("dan 189 000"). */
  priceVaries: boolean;
  /** Sum of available (stock − reserved) over active variants. */
  available: number;
  lowStock: boolean;
  outOfStock: boolean;
  /** Units sold in the last 30 days (orders not cancelled). */
  sold30d: number;
  missingIkpu: number;
  categorySlugs: string[];
}

export interface AdminProductPageDto {
  items: AdminProductRowDto[];
  nextCursor: string | null;
}

export interface AdminVariantDto {
  id: string;
  sku: string;
  label: LocalizedText;
  colorHex: string | null;
  volumeMl: number | null;
  priceSoum: number;
  compareAtSoum: number | null;
  ikpu: string | null;
  ikpuMissing: boolean;
  packageCode: string | null;
  vatPercent: number;
  barcode: string | null;
  weightGrams: number | null;
  stock: number;
  reserved: number;
  available: number;
  lowStockAt: number;
  active: boolean;
  sort: number;
  linkedToMoysklad: boolean;
}

export interface AdminProductImageDto {
  id: string;
  fileId: string;
  url: string;
  alt: LocalizedText;
  width: number | null;
  height: number | null;
  sort: number;
}

export interface AdminRelatedProductDto {
  id: string;
  slug: string;
  name: LocalizedText;
  status: ProductStatus;
}

export interface AdminProductSeoDto {
  /** Stored override; '' = the docs/10 template applies. */
  title: string;
  description: string;
  /** What the storefront shows today (override or template), for the SERP preview. */
  effectiveTitle: string;
}

export interface AdminSpecDto {
  key: LocalizedText;
  value: LocalizedText;
}

export interface AdminProductDto {
  id: string;
  slug: string;
  type: ProductType;
  status: ProductStatus;
  seller: { name: string; isOfficial: boolean };
  name: LocalizedText;
  subtitle: LocalizedText | null;
  shortDesc: LocalizedText;
  description: LocalizedText;
  /** One step per line. */
  howToApply: LocalizedText;
  specs: AdminSpecDto[];
  badges: string[];
  surfaces: string[];
  videoUrl: string | null;
  coverageM2PerL: number | null;
  dryTimeMinutes: number | null;
  isBestseller: boolean;
  bestsellerSort: number | null;
  categoryIds: string[];
  /** Extra search words (synonyms, misspellings), normalized. */
  keywords: string[];
  variants: AdminVariantDto[];
  images: AdminProductImageDto[];
  relations: Record<RelationKind, AdminRelatedProductDto[]>;
  seo: Record<'uz' | 'ru', AdminProductSeoDto>;
  locks: CatalogLocksDto;
  sold30d: number;
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────── Promo (A14) ─────────────────────────

export const PROMO_AUDIENCES = ['ALL', 'FIRST_ORDER', 'SEGMENT'] as const;
export type PromoAudience = (typeof PROMO_AUDIENCES)[number];

export type PromoState = 'active' | 'scheduled' | 'expired' | 'paused' | 'exhausted';

export interface AdminPromoStatsDto {
  /** Redemptions of orders that are not cancelled. */
  uses: number;
  discountSoum: number;
  /** Total of those orders (what the code brought in). */
  revenueSoum: number;
  suspicious: number;
}

export interface AdminPromoDto {
  id: string;
  code: string;
  type: PromoType;
  /** PERCENT: percent; FIXED: so'm; FREE_SHIPPING/GIFT: 0. */
  value: number;
  gift: {
    variantId: string;
    sku: string;
    label: string;
    productName: string;
    priceSoum: number;
  } | null;
  minCartSoum: number;
  audience: PromoAudience;
  segmentId: string | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  utmSource: string | null;
  active: boolean;
  state: PromoState;
  /** Redeemed at least once: the code text can no longer change. */
  locked: boolean;
  createdAt: string;
  stats: AdminPromoStatsDto;
}

export interface AdminPromoPageDto {
  items: AdminPromoDto[];
  nextCursor: string | null;
}

export interface AdminPromoSummaryDto {
  periodDays: number;
  kpis: {
    /** Share of non-cancelled orders in the period that used a code, 0–100 (null: no orders). */
    ordersWithCodePct: number | null;
    discountSoum: number;
    revenueSoum: number;
    suspicious: number;
  };
  rules: { maxDiscountPct: number };
  automatic: {
    freeShipping: { zone: LocalizedText; freeFromSoum: number | null }[];
    kits: { productId: string; name: LocalizedText; priceSoum: number; savingPct: number }[];
    /** docs/02 "2nd purchase gift" — off by default, no engine yet. */
    secondPurchaseGift: { enabled: boolean };
  };
  /** Active variants of active products, for the GIFT type picker. */
  giftOptions: { variantId: string; label: string; priceSoum: number }[];
  segments: { id: string; name: string }[];
}

/** Lifecycle shown in the list (paused wins, then dates, then limit). */
export function promoState(
  p: { active: boolean; startsAt: Date | null; endsAt: Date | null; usageLimit: number | null },
  uses: number,
  now: Date,
): PromoState {
  if (!p.active) return 'paused';
  if (p.endsAt && p.endsAt < now) return 'expired';
  if (p.startsAt && p.startsAt > now) return 'scheduled';
  if (p.usageLimit !== null && uses >= p.usageLimit) return 'exhausted';
  return 'active';
}

// ───────────────────────── Reviews (A15) ─────────────────────────

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface AdminReviewPhotoDto {
  fileId: string;
  url: string;
}

export interface AdminReviewDto {
  id: string;
  status: ReviewStatus;
  rating: number;
  text: string | null;
  locale: 'uz' | 'ru';
  source: string;
  createdAt: string;
  /** "Dilnoza Y." — first name + initial, like the storefront. */
  author: string;
  product: { id: string; slug: string; name: LocalizedText };
  variantLabel: LocalizedText | null;
  order: { id: string; number: string };
  photos: AdminReviewPhotoDto[];
  photoConsent: boolean;
  inGallery: boolean;
  gallerySort: number | null;
  before: AdminReviewPhotoDto | null;
  reply: string | null;
  moderatedBy: string | null;
}

export interface AdminReviewPageDto {
  items: AdminReviewDto[];
  nextCursor: string | null;
}

export interface AdminReviewsSummaryDto {
  /** Average of approved reviews (null: none yet). */
  avgRating: number | null;
  /** Approved reviews (every review is a verified purchase: docs/02). */
  approved: number;
  /** Share of approved reviews with a publishable photo, 0–100. */
  withPhotoPct: number | null;
  /** Rating ≤ 3, not rejected, no public reply yet. */
  openLowRated: number;
  counts: Record<ReviewStatus, number>;
}

export interface AdminGalleryItemDto {
  reviewId: string;
  sort: number;
  after: AdminReviewPhotoDto;
  before: AdminReviewPhotoDto | null;
  /** All of the customer's photos (pick "after"/"before" among them). */
  photos: AdminReviewPhotoDto[];
  productName: LocalizedText;
  author: string;
}
