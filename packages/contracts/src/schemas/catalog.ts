import { z } from 'zod';

export const PRODUCT_SORTS = ['popular', 'new', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const SURFACES = ['wood', 'lacquer', 'metal', 'fabric'] as const;
export type Surface = (typeof SURFACES)[number];

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).filter(Boolean)));

export const productListQuerySchema = z.object({
  category: z.string().optional(),
  surface: csv,
  color: csv,
  volume: csv,
  brand: csv,
  priceMin: z.coerce.number().int().nonnegative().optional(),
  priceMax: z.coerce.number().int().nonnegative().optional(),
  onSale: z.coerce.boolean().optional(),
  sort: z.enum(PRODUCT_SORTS).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export interface ImageDto {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  productCount: number;
  image: ImageDto | null;
}

export interface VariantDto {
  id: string;
  sku: string;
  label: string;
  colorHex: string | null;
  volumeMl: number | null;
  priceSoum: number;
  compareAtSoum: number | null;
  /** Available to sell = MoySklad stock − open reservations (never negative). */
  available: number;
  inStock: boolean;
  lowStock: boolean;
}

export interface ProductCardDto {
  id: string;
  slug: string;
  type: 'SIMPLE' | 'BUNDLE';
  name: string;
  categorySlug: string | null;
  categoryName: string | null;
  /** Short line under the name: "0,5 L · 1 L · 2,5 L" or "400 ml · 4 rang". */
  subtitle: string;
  badges: ('HIT' | 'NEW' | 'SALE')[];
  discountPct: number | null;
  priceFromSoum: number;
  compareAtSoum: number | null;
  hasPriceRange: boolean;
  defaultVariantId: string | null;
  image: ImageDto | null;
  inStock: boolean;
  seller: { slug: string; name: string; isOfficial: boolean };
}

export interface ProductListDto {
  items: ProductCardDto[];
  total: number;
  page: number;
  pages: number;
  facets: {
    colors: { hex: string; label: string; count: number }[];
    volumes: { volumeMl: number; label: string; count: number }[];
    brands: { slug: string; name: string; isOfficial: boolean; count: number }[];
    price: { minSoum: number; maxSoum: number };
  };
}

export interface ProductDetailDto extends ProductCardDto {
  shortDesc: string;
  description: string;
  howToApply: string[];
  specs: { key: string; value: string }[];
  surfaces: string[];
  coverageM2PerL: number | null;
  dryTimeMinutes: number | null;
  videoUrl: string | null;
  images: ImageDto[];
  variants: VariantDto[];
  /** Kit contents (BUNDLE only). */
  components: { productSlug: string; name: string; variantLabel: string; qty: number }[];
  rating: { average: number; count: number } | null;
  related: ProductCardDto[];
  upsell: ProductCardDto[];
  alternatives: ProductCardDto[];
}
