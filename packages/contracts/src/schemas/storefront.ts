import type { ContentBlock } from './content';
import type { CategoryDto, ImageDto, ProductCardDto } from './catalog';

/** GET /v1/content/home */
export interface SelectorItemDto {
  key: string;
  name: string;
  kind: string;
  image: ImageDto | null;
  title: string;
  contents: string;
  areaLabel: string | null;
  timeLabel: string | null;
  /** Live sum of item prices (so'm). */
  priceSoum: number;
  /** "Buy new" comparison; null → row hidden. */
  newItemPriceSoum: number | null;
  items: { variantId: string; productSlug: string; qty: number }[];
  inStock: boolean;
  /** Product page to open for details (first item's product). */
  productSlug: string | null;
}

export interface ReviewsSummaryDto {
  average: number;
  count: number;
  distribution: { stars: 1 | 2 | 3 | 4 | 5; pct: number }[];
  latest: {
    author: string;
    city: string | null;
    text: string;
    productName: string;
    image: ImageDto | null;
  }[];
}

export interface GalleryItemDto {
  title: string;
  meta: string;
  before: ImageDto | null;
  after: ImageDto;
}

/** Hero before/after slider; null → the hero renders without the slider. */
export interface HomeHeroDto {
  before: ImageDto;
  after: ImageDto;
  /** "Shu natija uchun" product card on the slider. */
  product: ProductCardDto | null;
}

/** "How it works" video tile. */
export interface HomeHowToDto {
  poster: ImageDto | null;
  videoUrl: string | null;
  durationMinutes: number | null;
}

export interface HomeContentDto {
  /** Optional media blocks (admin-managed); missing → block degrades gracefully. */
  hero: HomeHeroDto | null;
  howTo: HomeHowToDto | null;
  leadImage: ImageDto | null;
  selector: SelectorItemDto[];
  faq: { q: string; a: string }[];
  bestsellers: ProductCardDto[];
  /** null when there are no approved reviews yet → UI hides rating blocks (never fake numbers). */
  reviewsSummary: ReviewsSummaryDto | null;
  /** [] until real consented before/after photos exist → UI hides the gallery. */
  gallery: GalleryItemDto[];
}

/** GET /v1/content/pages/:kind/:slug */
export interface ContentPageDto {
  kind: string;
  slug: string;
  title: string;
  subtitle: string | null;
  /** Variables already resolved; blocks with missing data removed. */
  blocks: ContentBlock[];
  version: string | null;
  updatedAt: string;
  /** LEGAL: company data incomplete or lawyer review pending → show the draft notice. */
  draft: boolean;
  /** LEGAL sidebar. */
  siblings: { slug: string; title: string; subtitle: string | null }[];
}

/** GET /v1/catalog/search */
export interface SearchResultDto {
  query: string;
  products: ProductCardDto[];
  categories: CategoryDto[];
  /** Alternative queries / chips when nothing matched. */
  suggestions: string[];
}

/** POST /v1/leads */
export interface LeadResultDto {
  promoCode: string;
  telegramDeepLink: string | null;
}
