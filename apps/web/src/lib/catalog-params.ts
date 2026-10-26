import type { ProductSort } from '@forest/contracts';
import { PRODUCT_SORTS, SURFACES } from '@forest/contracts/core';

/**
 * Catalog URL state (shared by server pages and client filter islands):
 * `?surface=&color=&volume=&priceMin=&priceMax=&brand=&onSale=&sort=&page=`.
 * Lists are comma-separated; colours are lowercase hex without `#` (API format).
 */
export interface CatalogFilters {
  surface: string[];
  color: string[];
  volume: string[];
  brand: string[];
  priceMin?: number;
  priceMax?: number;
  onSale: boolean;
  sort: ProductSort;
  page: number;
}

export const PAGE_SIZE = 12;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v.join(',') : v;
}

function list(raw: RawParams, key: string, valid: (v: string) => boolean): string[] {
  const v = get(raw, key);
  if (!v) return [];
  return [...new Set(v.split(',').map((s) => s.trim().toLowerCase()))].filter(valid);
}

function int(raw: RawParams, key: string): number | undefined {
  const v = get(raw, key);
  if (!v || !/^\d{1,10}$/.test(v)) return undefined;
  return Number(v);
}

/** Lenient parse: unknown/invalid values are dropped instead of failing the page. */
export function parseCatalogParams(raw: RawParams): CatalogFilters {
  const sort = get(raw, 'sort');
  return {
    surface: list(raw, 'surface', (s) => (SURFACES as readonly string[]).includes(s)),
    color: list(raw, 'color', (s) => /^[0-9a-f]{6}$/.test(s)),
    volume: list(raw, 'volume', (s) => /^\d{1,6}$/.test(s)),
    brand: list(raw, 'brand', (s) => /^[a-z0-9-]{1,64}$/.test(s)),
    priceMin: int(raw, 'priceMin'),
    priceMax: int(raw, 'priceMax'),
    onSale: get(raw, 'onSale') === 'true',
    sort: (PRODUCT_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as ProductSort)
      : 'popular',
    page: Math.max(1, Math.min(500, int(raw, 'page') ?? 1)),
  };
}

/** Any filter or non-default sort → page is a refinement (noindex,follow + canonical to base). */
export function isRefined(f: CatalogFilters): boolean {
  return (
    f.surface.length > 0 ||
    f.color.length > 0 ||
    f.volume.length > 0 ||
    f.brand.length > 0 ||
    f.priceMin !== undefined ||
    f.priceMax !== undefined ||
    f.onSale ||
    f.sort !== 'popular'
  );
}

/** Page URL query (defaults omitted, stable key order so URLs are canonical-friendly). */
export function catalogSearch(f: CatalogFilters): string {
  const sp = new URLSearchParams();
  if (f.surface.length) sp.set('surface', f.surface.join(','));
  if (f.color.length) sp.set('color', f.color.join(','));
  if (f.volume.length) sp.set('volume', f.volume.join(','));
  if (f.priceMin !== undefined) sp.set('priceMin', String(f.priceMin));
  if (f.priceMax !== undefined) sp.set('priceMax', String(f.priceMax));
  if (f.brand.length) sp.set('brand', f.brand.join(','));
  if (f.onSale) sp.set('onSale', 'true');
  if (f.sort !== 'popular') sp.set('sort', f.sort);
  if (f.page > 1) sp.set('page', String(f.page));
  const s = sp.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '';
}

/** API query for `GET /catalog/products`. */
export function catalogApiQuery(f: CatalogFilters, category?: string, page = f.page): string {
  const sp = new URLSearchParams(catalogSearch({ ...f, page: 1 }).slice(1));
  if (category) sp.set('category', category);
  sp.set('page', String(page));
  sp.set('limit', String(PAGE_SIZE));
  return `?${sp.toString().replace(/%2C/g, ',')}`;
}

export const EMPTY_FILTERS: CatalogFilters = {
  surface: [],
  color: [],
  volume: [],
  brand: [],
  onSale: false,
  sort: 'popular',
  page: 1,
};

/** "1 L", "0,5 L", "400 ml" — same convention as the API facet labels. */
export function volumeLabel(ml: number): string {
  return ml >= 1000 ? `${String(ml / 1000).replace('.', ',')} L` : `${ml} ml`;
}
