import { Injectable } from '@nestjs/common';
import {
  LOCALES,
  type Locale,
  type SeoPageKind,
  type SeoTemplateVars,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import { availableQty } from '../catalog/catalog.mapper';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';

/** One indexable storefront page (locale-less path) with what its templates and checks need. */
export interface InventoryPage {
  path: string;
  kind: SeoPageKind;
  locales: Locale[];
  label: Record<Locale, string>;
  vars: Record<Locale, SeoTemplateVars>;
  lastmod: Date | null;
  /** Product pages: id, images and rich-result inputs. */
  product?: {
    id: string;
    slug: string;
    priceFromSoum: number;
    inStock: boolean;
    rating: { average: number; count: number } | null;
    images: { fileId: string; url: string; alt: Record<Locale, string> }[];
  };
}

/** Storefront routes that are pages even though they are not in the SEO inventory (noindex). */
export const PRIVATE_ROUTES = [
  '/savat',
  '/checkout',
  '/kabinet',
  '/buyurtma',
  '/kirish',
  '/fake-pay',
  '/qidiruv',
] as const;

/** Index-page descriptions; the storefront metadata uses the same text (messages `ilhom`/`brand`). */
export const ILHOM_TEXT = {
  uz: "Oldin va keyin loyihalari, qadamba-qadam video darslar va rang tanlash bo'yicha maslahatlar.",
  ru: 'Проекты «до и после», пошаговые видеоуроки и советы по выбору цвета.',
} as const;
export const BRAND_TEXT = {
  uz: "Forest mebel va divanni yangilash uchun Yevropa bo'yoqlari va aksessuarlarini O'zbekistonga olib keldi.",
  ru: 'Forest привёз в Узбекистан европейские краски и аксессуары для обновления мебели и диванов.',
} as const;

const placeholderFree = (s: string) =>
  s
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The indexable page inventory (docs/10 URLs): home, catalog, categories, ACTIVE products and
 * published legal pages. Feeds the sitemap, SEO health, the A9 page list and 404 suggestions.
 */
@Injectable()
export class SeoInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async pages(): Promise<InventoryPage[]> {
    const [products, categories, legal, ratings] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { slug: 'asc' },
        include: {
          variants: { where: { active: true } },
          images: { include: { file: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
        },
      }),
      this.prisma.category.findMany({
        orderBy: { sort: 'asc' },
        include: {
          products: {
            where: { product: { status: 'ACTIVE' } },
            select: { product: { select: { updatedAt: true } } },
          },
        },
      }),
      this.prisma.page.findMany({
        where: { kind: 'LEGAL', published: true },
        orderBy: [{ slug: 'asc' }, { locale: 'asc' }],
      }),
      this.prisma.review.groupBy({
        by: ['productId'],
        where: { status: 'APPROVED' },
        _avg: { rating: true },
        _count: true,
      }),
    ]);
    const both = (f: (l: Locale) => string) =>
      Object.fromEntries(LOCALES.map((l) => [l, f(l)])) as Record<Locale, string>;
    const latest = (dates: Date[]) =>
      dates.reduce<Date | null>((m, d) => (m === null || d > m ? d : m), null);
    const productLatest = latest(products.map((p) => p.updatedAt));

    const out: InventoryPage[] = [
      {
        path: '/',
        kind: 'home',
        locales: [...LOCALES],
        label: { uz: 'Bosh sahifa', ru: 'Главная' },
        vars: { uz: {}, ru: {} },
        lastmod: productLatest,
      },
      {
        path: '/katalog',
        kind: 'catalog',
        locales: [...LOCALES],
        label: { uz: 'Katalog', ru: 'Каталог' },
        vars: { uz: {}, ru: {} },
        lastmod: productLatest,
      },
    ];
    for (const c of categories) {
      out.push({
        path: `/katalog/${c.slug}`,
        kind: 'category',
        locales: [...LOCALES],
        label: both((l) => t(c.name, l)),
        vars: Object.fromEntries(
          LOCALES.map((l) => [
            l,
            { name: t(c.name, l), count: c.products.length, text: t(c.seoText, l) || null },
          ]),
        ) as Record<Locale, SeoTemplateVars>,
        lastmod: latest(c.products.map((x) => x.product.updatedAt)),
      });
    }
    const ratingOf = new Map(ratings.map((r) => [r.productId, r]));
    for (const p of products) {
      const r = ratingOf.get(p.id);
      const prices = p.variants.map((v) => tiyinToSoumInt(v.priceTiyin));
      out.push({
        path: `/p/${p.slug}`,
        kind: 'product',
        locales: [...LOCALES],
        label: both((l) => t(p.name, l)),
        vars: Object.fromEntries(
          LOCALES.map((l) => [l, { name: t(p.name, l), text: t(p.shortDesc, l) }]),
        ) as Record<Locale, SeoTemplateVars>,
        lastmod: p.updatedAt,
        product: {
          id: p.id,
          slug: p.slug,
          priceFromSoum: prices.length ? Math.min(...prices) : 0,
          inStock: p.variants.some((v) => availableQty(v) > 0),
          rating:
            r && r._count > 0
              ? { average: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count }
              : null,
          images: p.images
            .filter((i) => !i.isVideo && i.file.isPublic)
            .map((i) => ({
              fileId: i.fileId,
              url: this.files.publicUrl(i.file.key),
              alt: both((l) => {
                const v = i.alt as Record<string, unknown> | null;
                return typeof v?.[l] === 'string' ? (v[l] as string).trim() : '';
              }),
            })),
        },
      });
    }
    const legalBySlug = new Map<string, typeof legal>();
    for (const row of legal) legalBySlug.set(row.slug, [...(legalBySlug.get(row.slug) ?? []), row]);
    for (const [slug, rows] of legalBySlug) {
      const of = (l: Locale) => rows.find((r) => r.locale === l);
      const subtitle = (l: Locale) => {
        const data = of(l)?.data as { subtitle?: unknown } | null | undefined;
        return typeof data?.subtitle === 'string' ? placeholderFree(data.subtitle) : '';
      };
      out.push({
        path: `/${slug}`,
        kind: 'legal',
        locales: LOCALES.filter((l) => of(l)),
        label: both((l) => of(l)?.title ?? rows[0]!.title),
        vars: Object.fromEntries(
          LOCALES.map((l) => [l, { name: of(l)?.title ?? '', text: subtitle(l) }]),
        ) as Record<Locale, SeoTemplateVars>,
        lastmod: latest(rows.map((r) => r.updatedAt)),
      });
    }
    out.push(...(await this.cmsPages(both, latest)));
    return out;
  }

  /**
   * Ilhom index, published articles and the Brend page (Phase 5 CMS, CLAUDE.md §6). An article
   * exists only in the locales whose row is published; `/ilhom` and `/brend` always exist.
   */
  private async cmsPages(
    both: (f: (l: Locale) => string) => Record<Locale, string>,
    latest: (dates: Date[]) => Date | null,
  ): Promise<InventoryPage[]> {
    const rows = await this.prisma.page.findMany({
      where: { kind: { in: ['ARTICLE', 'PAGE'] }, published: true },
      orderBy: [{ slug: 'asc' }, { locale: 'asc' }],
    });
    const articles = rows.filter((r) => r.kind === 'ARTICLE');
    const brand = rows.filter((r) => r.kind === 'PAGE' && r.slug === 'brend');
    const excerpt = (data: unknown) => {
      const e = (data as { excerpt?: unknown } | null)?.excerpt;
      return typeof e === 'string' ? placeholderFree(e) : '';
    };
    const out: InventoryPage[] = [
      {
        path: '/ilhom',
        kind: 'article',
        locales: [...LOCALES],
        label: { uz: 'Ilhom', ru: 'Вдохновение' },
        vars: {
          uz: { name: 'Ilhom', text: ILHOM_TEXT.uz },
          ru: { name: 'Вдохновение', text: ILHOM_TEXT.ru },
        },
        lastmod: latest(articles.map((r) => r.updatedAt)),
      },
      {
        path: '/brend',
        kind: 'article',
        locales: [...LOCALES],
        label: { uz: 'Brend haqida', ru: 'О бренде' },
        vars: {
          uz: { name: 'Forest haqida', text: BRAND_TEXT.uz },
          ru: { name: 'О Forest', text: BRAND_TEXT.ru },
        },
        lastmod: latest(brand.map((r) => r.updatedAt)),
      },
    ];
    const bySlug = new Map<string, typeof articles>();
    for (const r of articles) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);
    for (const [slug, group] of bySlug) {
      const of = (l: Locale) => group.find((r) => r.locale === l);
      out.push({
        path: `/ilhom/${slug}`,
        kind: 'article',
        locales: LOCALES.filter((l) => of(l)),
        label: both((l) => of(l)?.title ?? group[0]!.title),
        vars: Object.fromEntries(
          LOCALES.map((l) => [l, { name: of(l)?.title ?? '', text: excerpt(of(l)?.data) }]),
        ) as Record<Locale, SeoTemplateVars>,
        lastmod: latest(group.map((r) => r.updatedAt)),
      });
    }
    return out;
  }

  /** Locale-prefixed live paths (`/uz`, `/uz/p/x`…) incl. private routes. */
  static livePaths(pages: InventoryPage[]): Set<string> {
    const live = new Set<string>();
    for (const l of LOCALES) {
      for (const r of PRIVATE_ROUTES) live.add(`/${l}${r}`);
    }
    for (const p of pages)
      for (const l of p.locales) live.add(p.path === '/' ? `/${l}` : `/${l}${p.path}`);
    return live;
  }
}
