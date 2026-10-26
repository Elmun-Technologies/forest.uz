import { Injectable } from '@nestjs/common';
import {
  type CategoryDto,
  DomainError,
  type Locale,
  type ProductCardDto,
  type ProductDetailDto,
  type ProductListDto,
  type ProductListQuery,
  type ProductReviewsDto,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  availableQty,
  formatVolume,
  mapProductCard,
  mapVariant,
  reviewAuthor,
} from './catalog.mapper';

const cardInclude = {
  variants: true,
  categories: { include: { category: true } },
  seller: { select: { slug: true, name: true, isOfficial: true } },
  images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

const REVIEWS_PAGE_SIZE = 6;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  private toCard(p: CardRow, locale: Locale): ProductCardDto {
    const card = mapProductCard(p, locale);
    const img = p.images[0];
    card.image = img ? this.files.image(img.file, img.alt ?? p.name, locale) : null;
    return card;
  }

  async categories(locale: Locale): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { sort: 'asc' },
      include: {
        image: true,
        _count: { select: { products: { where: { product: { status: 'ACTIVE' } } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: t(c.name, locale),
      productCount: c._count.products,
      image: this.files.image(c.image, c.name, locale),
      seoText: c.seoText ? t(c.seoText, locale) || null : null,
    }));
  }

  /**
   * Catalog sizes here are small (hundreds of SKUs), so filtering/faceting runs in memory over
   * active products. Swap for SQL filtering if the catalog grows past a few thousand products.
   */
  async list(q: ProductListQuery, locale: Locale): Promise<ProductListDto> {
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(q.category ? { categories: { some: { category: { slug: q.category } } } } : {}),
      },
      include: cardInclude,
    });

    const matches = (p: CardRow, skip?: 'color' | 'volume' | 'brand'): boolean => {
      const active = p.variants.filter((v) => v.active);
      if (q.surface.length && !p.surfaces.some((s) => q.surface.includes(s))) return false;
      if (
        skip !== 'color' &&
        q.color.length &&
        !active.some(
          (v) => v.colorHex && q.color.includes(v.colorHex.replace('#', '').toLowerCase()),
        )
      )
        return false;
      if (
        skip !== 'volume' &&
        q.volume.length &&
        !active.some((v) => v.volumeMl && q.volume.includes(String(v.volumeMl)))
      )
        return false;
      if (skip !== 'brand' && q.brand.length && !q.brand.includes(p.seller.slug)) return false;
      const min = active.reduce<bigint | null>(
        (m, v) => (m === null || v.priceTiyin < m ? v.priceTiyin : m),
        null,
      );
      const minSoum = min === null ? 0 : tiyinToSoumInt(min);
      if (q.priceMin !== undefined && minSoum < q.priceMin) return false;
      if (q.priceMax !== undefined && minSoum > q.priceMax) return false;
      if (q.onSale && !active.some((v) => v.compareAtTiyin && v.compareAtTiyin > v.priceTiyin))
        return false;
      return true;
    };

    const filtered = rows.filter((p) => matches(p));
    const cards = filtered.map((p) => ({ row: p, card: this.toCard(p, locale) }));
    cards.sort((a, b) => {
      switch (q.sort) {
        case 'new':
          return b.row.createdAt.getTime() - a.row.createdAt.getTime();
        case 'price_asc':
          return a.card.priceFromSoum - b.card.priceFromSoum;
        case 'price_desc':
          return b.card.priceFromSoum - a.card.priceFromSoum;
        default:
          // In-stock first, then 30-day popularity.
          return (
            Number(b.card.inStock) - Number(a.card.inStock) || b.row.popularity - a.row.popularity
          );
      }
    });

    const total = cards.length;
    const pages = Math.max(1, Math.ceil(total / q.limit));
    const page = Math.min(q.page, pages);
    const items = cards.slice((page - 1) * q.limit, page * q.limit).map((c) => c.card);

    // Facets count products matching all other filters (standard "disjunctive" faceting).
    const colors = new Map<string, { hex: string; label: string; count: number }>();
    const volumes = new Map<number, { volumeMl: number; label: string; count: number }>();
    const brands = new Map<
      string,
      { slug: string; name: string; isOfficial: boolean; count: number }
    >();
    for (const p of rows) {
      const active = p.variants.filter((v) => v.active);
      if (matches(p, 'color')) {
        for (const hex of new Set(
          active.map((v) => v.colorHex).filter((h): h is string => Boolean(h)),
        )) {
          const label = t(active.find((v) => v.colorHex === hex)?.label, locale);
          const key = hex.replace('#', '').toLowerCase();
          colors.set(key, { hex, label, count: (colors.get(key)?.count ?? 0) + 1 });
        }
      }
      if (matches(p, 'volume')) {
        for (const ml of new Set(
          active.map((v) => v.volumeMl).filter((m): m is number => Boolean(m)),
        )) {
          const existing = volumes.get(ml);
          // Colour variants are labelled by colour, so their volume label is derived ("400 ml").
          const sample = active.find((v) => v.volumeMl === ml && !v.colorHex);
          const label =
            existing?.label ?? (sample ? t(sample.label, locale) : formatVolume(ml, locale));
          volumes.set(ml, { volumeMl: ml, label, count: (existing?.count ?? 0) + 1 });
        }
      }
      if (matches(p, 'brand')) {
        const b = brands.get(p.seller.slug);
        brands.set(p.seller.slug, { ...p.seller, count: (b?.count ?? 0) + 1 });
      }
    }
    const allPrices = rows.flatMap((p) =>
      p.variants.filter((v) => v.active).map((v) => tiyinToSoumInt(v.priceTiyin)),
    );
    return {
      items,
      total,
      page,
      pages,
      facets: {
        colors: [...colors.values()],
        volumes: [...volumes.values()].sort((a, b) => a.volumeMl - b.volumeMl),
        brands: [...brands.values()],
        price: {
          minSoum: allPrices.length ? Math.min(...allPrices) : 0,
          maxSoum: allPrices.length ? Math.max(...allPrices) : 0,
        },
      },
    };
  }

  async bestsellers(locale: Locale, limit = 8): Promise<ProductCardDto[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', isBestseller: true },
      orderBy: [{ bestsellerSort: 'asc' }, { popularity: 'desc' }],
      take: limit,
      include: cardInclude,
    });
    return rows.map((p) => this.toCard(p, locale));
  }

  /** Active product cards for an explicit id list (favorites, search hits), in the given order. */
  async byIds(ids: readonly string[], locale: Locale): Promise<ProductCardDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...ids] }, status: 'ACTIVE' },
      include: cardInclude,
    });
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      return p ? [this.toCard(p, locale)] : [];
    });
  }

  async bySlug(slug: string, locale: Locale): Promise<ProductCardDto | null> {
    const p = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      include: cardInclude,
    });
    return p ? this.toCard(p, locale) : null;
  }

  /** Approved reviews, newest first; photos only with publication consent. */
  async reviews(slug: string, page: number, locale: Locale): Promise<ProductReviewsDto> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND');
    const where = { productId: product.id, status: 'APPROVED' as const };
    const [total, rows] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * REVIEWS_PAGE_SIZE,
        take: REVIEWS_PAGE_SIZE,
        include: { customer: { select: { name: true } } },
      }),
    ]);
    const photoIds = rows.flatMap((r) => (r.photoConsent ? r.photoFileIds : []));
    const files = photoIds.length
      ? new Map(
          (await this.prisma.file.findMany({ where: { id: { in: photoIds } } })).map((f) => [
            f.id,
            f,
          ]),
        )
      : new Map<string, never>();
    return {
      items: rows.map((r) => ({
        id: r.id,
        author: reviewAuthor(r.customer.name, locale),
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        photos: r.photoConsent
          ? r.photoFileIds
              .map((id) => this.files.image(files.get(id), product.name, locale))
              .filter((i): i is NonNullable<typeof i> => i !== null)
          : [],
        reply: r.reply,
      })),
      page,
      pageCount: Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE)),
      total,
    };
  }

  async detail(slug: string, locale: Locale): Promise<ProductDetailDto> {
    const p = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      include: {
        ...cardInclude,
        images: { include: { file: true }, orderBy: { sort: 'asc' } },
        bundleItems: {
          include: { variant: { include: { product: { select: { slug: true, name: true } } } } },
        },
        related: { include: { to: { include: cardInclude } }, orderBy: { sort: 'asc' } },
      },
    });
    if (!p) throw new DomainError('PRODUCT_NOT_FOUND');

    const reviews = await this.prisma.review.aggregate({
      where: { productId: p.id, status: 'APPROVED' },
      _avg: { rating: true },
      _count: true,
    });

    const card = this.toCard({ ...p, images: p.images.slice(0, 1) }, locale);
    const relatedOf = (kind: string) =>
      p.related
        .filter((r) => r.kind === kind && r.to.status === 'ACTIVE')
        .map((r) => this.toCard(r.to, locale));
    const specs = Array.isArray(p.specs) ? (p.specs as { key: unknown; value: unknown }[]) : [];

    return {
      ...card,
      shortDesc: t(p.shortDesc, locale),
      description: t(p.description, locale),
      howToApply: t(p.howToApply, locale).split('\n').filter(Boolean),
      specs: specs.map((s) => ({ key: t(s.key, locale), value: t(s.value, locale) })),
      surfaces: p.surfaces,
      coverageM2PerL: p.coverageM2PerL ? Number(p.coverageM2PerL) : null,
      dryTimeMinutes: p.dryTimeMinutes,
      videoUrl: p.videoUrl,
      images: p.images
        .map((img) => this.files.image(img.file, img.alt ?? p.name, locale))
        .filter((i): i is NonNullable<typeof i> => i !== null),
      variants: p.variants
        .filter((v) => v.active)
        .sort((a, b) => a.sort - b.sort)
        .map((v) => mapVariant(v, locale)),
      components: p.bundleItems.map((b) => ({
        productSlug: b.variant.product.slug,
        name: t(b.variant.product.name, locale),
        variantLabel: t(b.variant.label, locale),
        qty: b.qty,
      })),
      // Only real approved reviews count; no reviews → null → UI hides rating blocks.
      rating:
        reviews._count > 0
          ? { average: Math.round((reviews._avg.rating ?? 0) * 10) / 10, count: reviews._count }
          : null,
      related: relatedOf('CROSS_SELL'),
      upsell: relatedOf('UPSELL'),
      alternatives: relatedOf('ALTERNATIVE').filter((c) => c.inStock),
    };
  }

  /** Exposed for cart/checkout: availability helper. */
  static available = availableQty;
}
