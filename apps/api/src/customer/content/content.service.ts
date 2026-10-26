import { Injectable, Logger } from '@nestjs/common';
import {
  type ContentBlock,
  type ContentPageDto,
  DomainError,
  type GalleryItemDto,
  type HomeContentDto,
  LEGAL_SLUGS,
  type Locale,
  PAGE_KINDS,
  type PageKind,
  type ReviewsSummaryDto,
  type SelectorItemDto,
  contentBodySchema,
  t,
  tiyinToSoumInt,
} from '@forest/contracts';
import { z } from 'zod';
import { availableQty } from '../../catalog/catalog.mapper';
import { CatalogService } from '../../catalog/catalog.service';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type ContentVars, buildContentVars, fillBlocks, fillText } from './blocks';

const selectorItemsSchema = z.array(
  z.object({ sku: z.string(), qty: z.number().int().positive() }),
);
const pageDataSchema = z.object({ subtitle: z.string().optional() }).passthrough();

const ANONYMOUS_AUTHOR = { uz: 'Xaridor', ru: 'Покупатель' } as const;
const LATEST_REVIEWS = 3;
const GALLERY_MAX = 12;

@Injectable()
export class ContentService {
  private readonly logger = new Logger('Content');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly files: FilesService,
  ) {}

  async vars(): Promise<ContentVars> {
    const [store, returns, zones] = await Promise.all([
      this.settings.get('store.info'),
      this.settings.get('returns.rules'),
      this.settings.get('delivery.zones'),
    ]);
    return buildContentVars(store, returns, zones);
  }

  async home(locale: Locale): Promise<HomeContentDto> {
    const vars = await this.vars();
    const [selector, faq, bestsellers, reviewsSummary, gallery] = await Promise.all([
      this.selector(locale),
      this.homeFaq(locale, vars),
      this.catalog.bestsellers(locale),
      this.reviewsSummary(locale),
      this.gallery(locale),
    ]);
    return { selector, faq, bestsellers, reviewsSummary, gallery };
  }

  /** Tiles priced live from current variant prices; a tile whose SKU no longer sells is hidden. */
  private async selector(locale: Locale): Promise<SelectorItemDto[]> {
    const tiles = await this.prisma.selectorItem.findMany({
      where: { active: true },
      orderBy: { sort: 'asc' },
      include: { image: true },
    });
    const parsed = tiles.map((tile) => ({
      tile,
      items: selectorItemsSchema.safeParse(tile.items),
    }));
    const skus = parsed.flatMap((p) => (p.items.success ? p.items.data.map((i) => i.sku) : []));
    const variants = await this.prisma.variant.findMany({
      where: { sku: { in: skus }, active: true, product: { status: 'ACTIVE' } },
      include: { product: { select: { slug: true } } },
    });
    const bySku = new Map(variants.map((v) => [v.sku, v]));

    return parsed.flatMap(({ tile, items }) => {
      if (!items.success || items.data.length === 0) {
        this.logger.warn(`selector "${tile.key}": invalid items JSON`);
        return [];
      }
      const resolved: { qty: number; variant: (typeof variants)[number] }[] = [];
      for (const i of items.data) {
        const variant = bySku.get(i.sku);
        if (!variant) return [];
        resolved.push({ qty: i.qty, variant });
      }
      const total = resolved.reduce((sum, l) => sum + l.variant.priceTiyin * BigInt(l.qty), 0n);
      const label = (v: unknown) => t(v, locale) || null;
      const dto: SelectorItemDto = {
        key: tile.key,
        name: t(tile.name, locale),
        kind: t(tile.kind, locale),
        image: this.files.image(tile.image, tile.name, locale),
        title: t(tile.title, locale),
        contents: t(tile.contents, locale),
        areaLabel: label(tile.areaLabel),
        timeLabel: label(tile.timeLabel),
        priceSoum: tiyinToSoumInt(total),
        newItemPriceSoum: tile.newItemPriceSoum,
        items: resolved.map((l) => ({
          variantId: l.variant.id,
          productSlug: l.variant.product.slug,
          qty: l.qty,
        })),
        inStock: resolved.every((l) => availableQty(l.variant) >= l.qty),
        productSlug: resolved[0]?.variant.product.slug ?? null,
      };
      return [dto];
    });
  }

  private async homeFaq(locale: Locale, vars: ContentVars): Promise<{ q: string; a: string }[]> {
    const page = await this.findPage('FAQ', 'home', locale);
    if (!page) return [];
    return fillBlocks(this.parseBody(page), vars).flatMap((b) => (b.type === 'faq' ? b.items : []));
  }

  /** Real aggregate of APPROVED reviews only; null when there are none (UI hides rating blocks). */
  private async reviewsSummary(locale: Locale): Promise<ReviewsSummaryDto | null> {
    const where = { status: 'APPROVED' as const, product: { status: 'ACTIVE' as const } };
    const [agg, groups, latest] = await Promise.all([
      this.prisma.review.aggregate({ where, _avg: { rating: true }, _count: true }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: true }),
      this.prisma.review.findMany({
        where: { ...where, text: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: LATEST_REVIEWS,
        include: { customer: { select: { name: true } }, product: { select: { name: true } } },
      }),
    ]);
    if (agg._count === 0) return null;
    const photoFiles = await this.reviewFiles(
      latest.flatMap((r) => (r.photoConsent && r.photoFileIds[0] ? [r.photoFileIds[0]] : [])),
    );
    return {
      average: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      count: agg._count,
      distribution: ([5, 4, 3, 2, 1] as const).map((stars) => ({
        stars,
        pct: Math.round(((groups.find((g) => g.rating === stars)?._count ?? 0) * 100) / agg._count),
      })),
      latest: latest.map((r) => ({
        author: authorName(r.customer.name, locale),
        city: null,
        text: r.text ?? '',
        productName: t(r.product.name, locale),
        image:
          r.photoConsent && r.photoFileIds[0]
            ? this.files.image(photoFiles.get(r.photoFileIds[0]), r.product.name, locale)
            : null,
      })),
    };
  }

  /** Consented, approved before/after photos curated into the gallery; [] until they exist. */
  private async gallery(locale: Locale): Promise<GalleryItemDto[]> {
    const rows = await this.prisma.review.findMany({
      where: { status: 'APPROVED', photoConsent: true, inGallery: true },
      orderBy: [{ gallerySort: 'asc' }, { createdAt: 'desc' }],
      take: GALLERY_MAX,
      include: { customer: { select: { name: true } }, product: { select: { name: true } } },
    });
    const files = await this.reviewFiles(
      rows.flatMap((r) => [r.photoFileIds[0], r.beforeFileId].filter((x): x is string => !!x)),
    );
    return rows.flatMap((r) => {
      const after = this.files.image(files.get(r.photoFileIds[0] ?? ''), r.product.name, locale);
      if (!after) return [];
      return [
        {
          title: t(r.product.name, locale),
          meta: authorName(r.customer.name, locale),
          before: r.beforeFileId
            ? this.files.image(files.get(r.beforeFileId), r.product.name, locale)
            : null,
          after,
        },
      ];
    });
  }

  private async reviewFiles(ids: string[]) {
    if (!ids.length) return new Map<string, never>();
    const rows = await this.prisma.file.findMany({ where: { id: { in: ids } } });
    return new Map(rows.map((f) => [f.id, f]));
  }

  // ───────── Pages ─────────

  async page(kindParam: string, slug: string, locale: Locale): Promise<ContentPageDto> {
    const kind = kindParam.toUpperCase();
    if (!(PAGE_KINDS as readonly string[]).includes(kind)) throw new DomainError('NOT_FOUND');
    const page = await this.findPage(kind as PageKind, slug, locale);
    if (!page) throw new DomainError('NOT_FOUND');

    const [vars, store] = await Promise.all([this.vars(), this.settings.get('store.info')]);
    const legalComplete = Object.values(store.legal).every(
      (v) => typeof v === 'string' && v !== '',
    );
    const isLegal = kind === 'LEGAL';
    return {
      kind,
      slug: page.slug,
      title: fillText(page.title, vars) ?? page.title.replace(/\{[^}]*\}/g, '').trim(),
      subtitle: this.subtitle(page.data, vars),
      blocks: fillBlocks(this.parseBody(page), vars),
      version: page.version,
      updatedAt: page.updatedAt.toISOString(),
      draft: isLegal && !legalComplete,
      siblings: isLegal ? await this.legalSiblings(page.locale, vars) : [],
    };
  }

  private async legalSiblings(
    locale: Locale,
    vars: ContentVars,
  ): Promise<ContentPageDto['siblings']> {
    const rows = await this.prisma.page.findMany({
      where: { kind: 'LEGAL', locale, published: true },
      select: { slug: true, title: true, data: true },
    });
    const order = (slug: string) => {
      const i = (LEGAL_SLUGS as readonly string[]).indexOf(slug);
      return i === -1 ? LEGAL_SLUGS.length : i;
    };
    return rows
      .sort((a, b) => order(a.slug) - order(b.slug) || a.slug.localeCompare(b.slug))
      .map((r) => ({ slug: r.slug, title: r.title, subtitle: this.subtitle(r.data, vars) }));
  }

  /** Published page in the requested locale, falling back to the Uzbek source copy. */
  private async findPage(kind: PageKind, slug: string, locale: Locale) {
    const rows = await this.prisma.page.findMany({
      where: { kind, slug, published: true, locale: { in: [locale, 'uz'] } },
    });
    return rows.find((r) => r.locale === locale) ?? rows[0] ?? null;
  }

  private parseBody(page: { kind: string; slug: string; body: unknown }): ContentBlock[] {
    const r = contentBodySchema.safeParse(page.body);
    if (r.success) return r.data;
    this.logger.warn(`page ${page.kind}/${page.slug}: invalid body, rendering empty`);
    return [];
  }

  private subtitle(data: unknown, vars: ContentVars): string | null {
    const s = pageDataSchema.safeParse(data ?? {});
    return s.success && s.data.subtitle ? fillText(s.data.subtitle, vars) : null;
  }
}

function authorName(name: string | null, locale: Locale): string {
  // First name only: reviews are public, full names are not.
  return name?.trim().split(/\s+/)[0] || ANONYMOUS_AUTHOR[locale];
}
