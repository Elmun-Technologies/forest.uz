import {
  type Locale,
  type ProductCardDto,
  type VariantDto,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';

/** Minimal shapes the mapper needs (subset of Prisma rows) — keeps the mapper pure and testable. */
export interface VariantRow {
  id: string;
  sku: string;
  label: unknown;
  colorHex: string | null;
  volumeMl: number | null;
  priceTiyin: bigint;
  compareAtTiyin: bigint | null;
  stock: number;
  reserved: number;
  lowStockAt: number;
  active: boolean;
  sort: number;
}

export interface ProductRow {
  id: string;
  slug: string;
  type: 'SIMPLE' | 'BUNDLE';
  name: unknown;
  subtitle: unknown;
  badges: string[];
  createdAt: Date;
  popularity: number;
  surfaces: string[];
  variants: VariantRow[];
  categories: { category: { slug: string; name: unknown; sort: number } }[];
  seller: { slug: string; name: string; isOfficial: boolean };
}

export function availableQty(v: Pick<VariantRow, 'stock' | 'reserved'>): number {
  return Math.max(0, v.stock - v.reserved);
}

export function mapVariant(v: VariantRow, locale: Locale): VariantDto {
  const available = availableQty(v);
  return {
    id: v.id,
    sku: v.sku,
    label: t(v.label, locale),
    colorHex: v.colorHex,
    volumeMl: v.volumeMl,
    priceSoum: tiyinToSoumInt(v.priceTiyin),
    compareAtSoum: v.compareAtTiyin ? tiyinToSoumInt(v.compareAtTiyin) : null,
    available,
    inStock: available > 0,
    lowStock: available > 0 && available < v.lowStockAt,
  };
}

const VOLUME_UNITS = { uz: { l: 'L', ml: 'ml' }, ru: { l: 'л', ml: 'мл' } } as const;

export function formatVolume(ml: number, locale: Locale): string {
  const u = VOLUME_UNITS[locale];
  return ml >= 1000 ? `${String(ml / 1000).replace('.', ',')} ${u.l}` : `${ml} ${u.ml}`;
}

/** Card line under the name, e.g. "0,5 L · 1 L · 2,5 L" or "400 ml · 4 rang". */
export function buildSubtitle(
  p: Pick<ProductRow, 'subtitle' | 'variants'>,
  locale: Locale,
): string {
  const override = t(p.subtitle, locale);
  if (override) return override;
  const variants = p.variants.filter((v) => v.active);
  const colors = new Set(variants.map((v) => v.colorHex).filter(Boolean));
  if (colors.size > 1) {
    const vol = variants[0]?.volumeMl;
    const colorsLabel = locale === 'ru' ? `${colors.size} цвета` : `${colors.size} rang`;
    return vol ? `${formatVolume(vol, locale)} · ${colorsLabel}` : colorsLabel;
  }
  return variants.map((v) => t(v.label, locale)).join(' · ');
}

export function mapProductCard(p: ProductRow, locale: Locale): ProductCardDto {
  const variants = p.variants.filter((v) => v.active).sort((a, b) => a.sort - b.sort);
  const prices = variants.map((v) => v.priceTiyin);
  const min = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : 0n;
  const max = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : 0n;
  const cheapest = variants.find((v) => v.priceTiyin === min) ?? null;
  const compareAt =
    cheapest?.compareAtTiyin && cheapest.compareAtTiyin > min ? cheapest.compareAtTiyin : null;
  const discountPct = compareAt
    ? Math.round(Number(((compareAt - min) * 1000n) / compareAt) / 10)
    : null;
  const primaryCategory = [...p.categories].sort((a, b) => a.category.sort - b.category.sort)[0]
    ?.category;
  const inStockVariant = variants.find((v) => availableQty(v) > 0);
  return {
    id: p.id,
    slug: p.slug,
    type: p.type,
    name: t(p.name, locale),
    categorySlug: primaryCategory?.slug ?? null,
    categoryName: primaryCategory ? t(primaryCategory.name, locale) : null,
    subtitle: buildSubtitle(p, locale),
    badges: p.badges.filter((b): b is 'HIT' | 'NEW' | 'SALE' => ['HIT', 'NEW', 'SALE'].includes(b)),
    discountPct,
    priceFromSoum: tiyinToSoumInt(min),
    compareAtSoum: compareAt ? tiyinToSoumInt(compareAt) : null,
    hasPriceRange: max > min,
    defaultVariantId: (inStockVariant ?? variants[0])?.id ?? null,
    image: null,
    inStock: Boolean(inStockVariant),
    seller: p.seller,
  };
}
