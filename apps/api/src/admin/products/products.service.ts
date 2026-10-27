import { Injectable } from '@nestjs/common';
import {
  type AdminProductDto,
  type AdminProductListQuery,
  type AdminProductPageDto,
  type AdminProductRowDto,
  type AdminProductsMetaDto,
  DomainError,
  isValidIkpu,
  LOCALES,
  normalizeSearch,
  type ProductCreateInput,
  type ProductRelationsInput,
  productSeoTitle,
  type ProductUpdateInput,
  RELATION_KINDS,
  settingSchemas,
  type RelationKind,
  slugify,
  soumToTiyin,
  tiyinToSoumInt,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { availableQty } from '../../catalog/catalog.mapper';
import { saveRedirect } from '../../customer/seo/redirects';
import { redirectCandidates } from '../../customer/seo/seo-paths';
import { PrismaService } from '../../prisma/prisma.service';
import { SeoEventsService } from '../../seo/seo-events.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminUploadService } from '../files/upload.service';
import { CatalogSourceService } from './catalog-source.service';
import { afterCursor, encodeCursor } from './cursor';
import {
  baseSearchText,
  buildSearchText,
  keywordsOf,
  localized,
  skuStem,
  specsOf,
} from './product-text';

type Tx = Prisma.TransactionClient;

const detailInclude = {
  seller: { select: { name: true, isOfficial: true } },
  variants: { orderBy: [{ sort: 'asc' }, { sku: 'asc' }] },
  images: { include: { file: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
  categories: { select: { categoryId: true } },
  related: {
    orderBy: { sort: 'asc' },
    include: { to: { select: { id: true, slug: true, name: true, status: true } } },
  },
} satisfies Prisma.ProductInclude;

const rowInclude = {
  variants: true,
  images: { include: { file: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }], take: 1 },
  categories: { include: { category: { select: { slug: true } } } },
} satisfies Prisma.ProductInclude;

/** Storefront product path without locale (SeoMeta rows carry the locale themselves). */
export const productSeoPath = (slug: string) => `/p/${slug}`;

const DAY_MS = 86_400_000;

/** Product fields stored as-is (JSON or scalar) — diffed for the audit row. */
const PLAIN_FIELDS = [
  'name',
  'subtitle',
  'shortDesc',
  'description',
  'howToApply',
  'specs',
  'badges',
  'surfaces',
  'videoUrl',
  'coverageM2PerL',
  'dryTimeMinutes',
  'isBestseller',
  'bestsellerSort',
] as const;

/**
 * Admin A11 products: list + KPIs, product CRUD, slug/SEO, categories, relations. Variants and
 * images have their own services; every mutation returns the fresh `AdminProductDto`.
 */
@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly source: CatalogSourceService,
    private readonly settings: SettingsService,
    private readonly uploads: AdminUploadService,
    private readonly seoEvents: SeoEventsService,
  ) {}

  /**
   * After a committed change to the product (variants, images…): storefront revalidation, sitemap
   * and IndexNow (fire-and-forget), then the fresh DTO.
   */
  changed(id: string): Promise<AdminProductDto> {
    void this.seoEvents.productChanged(id);
    return this.get(id);
  }

  async meta(): Promise<AdminProductsMetaDto> {
    const [variants, categories, seller, locks, checkedAt, rules] = await Promise.all([
      this.prisma.variant.findMany({
        where: { active: true, product: { status: { not: 'ARCHIVED' } } },
        select: {
          ikpu: true,
          stock: true,
          reserved: true,
          lowStockAt: true,
          productId: true,
          product: { select: { status: true } },
        },
      }),
      this.prisma.category.findMany({
        orderBy: { sort: 'asc' },
        select: { id: true, slug: true, name: true },
      }),
      this.officialSeller(),
      this.source.locks(),
      this.source.checkedAt(),
      this.settings.get('catalog.rules'),
    ]);
    const live = variants.filter((v) => v.product.status === 'ACTIVE');
    return {
      kpis: {
        activeProducts: new Set(live.map((v) => v.productId)).size,
        activeVariants: live.length,
        lowStockVariants: live.filter((v) => {
          const a = availableQty(v);
          return a > 0 && a < v.lowStockAt;
        }).length,
        missingIkpuVariants: variants.filter((v) => !isValidIkpu(v.ikpu)).length,
      },
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: localized(c.name) })),
      locks,
      sourceCheckedAt: checkedAt?.toISOString() ?? null,
      seller: { name: seller.name, isOfficial: seller.isOfficial },
      lowStockDefault: rules.lowStockDefault,
    };
  }

  async list(q: AdminProductListQuery): Promise<AdminProductPageDto> {
    const term = q.q ? normalizeSearch(q.q) : '';
    const where: Prisma.ProductWhereInput = {
      AND: [
        q.status ? { status: q.status } : {},
        q.category ? { categories: { some: { category: { slug: q.category } } } } : {},
        q.q
          ? {
              OR: [
                ...(term ? [{ searchText: { contains: term } }] : []),
                { slug: { contains: q.q.toLowerCase() } },
                { variants: { some: { sku: { contains: q.q.toUpperCase() } } } },
              ],
            }
          : {},
        afterCursor(q.cursor, 'asc'),
      ],
    };
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: rowInclude,
    });
    const page = rows.slice(0, q.limit);
    const sold = await this.soldLast30Days(page.map((p) => p.id));
    const last = page.at(-1);
    return {
      items: page.map((p): AdminProductRowDto => {
        const active = p.variants.filter((v) => v.active).sort((a, b) => a.sort - b.sort);
        const prices = active.map((v) => v.priceTiyin);
        const min = prices.reduce<bigint | null>((m, x) => (m === null || x < m ? x : m), null);
        const avail = active.map((v) => ({ a: availableQty(v), low: v.lowStockAt }));
        const img = p.images[0];
        return {
          id: p.id,
          slug: p.slug,
          name: localized(p.name),
          type: p.type,
          status: p.status,
          image: img ? { url: this.uploads.url(img.file.key), alt: localized(img.alt).uz } : null,
          sku: skuStem(p.variants.sort((a, b) => a.sort - b.sort).map((v) => v.sku)),
          variantCount: p.variants.length,
          priceFromSoum: min === null ? null : tiyinToSoumInt(min),
          priceVaries: new Set(prices).size > 1,
          available: avail.reduce((s, x) => s + x.a, 0),
          lowStock: avail.some((x) => x.a > 0 && x.a < x.low),
          outOfStock: active.length > 0 && avail.every((x) => x.a === 0),
          sold30d: sold.get(p.id) ?? 0,
          missingIkpu: active.filter((v) => !isValidIkpu(v.ikpu)).length,
          categorySlugs: p.categories.map((c) => c.category.slug),
        };
      }),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(id: string, db: Tx | PrismaService = this.prisma): Promise<AdminProductDto> {
    const p = await db.product.findUnique({ where: { id }, include: detailInclude });
    if (!p) throw new DomainError('PRODUCT_NOT_FOUND');
    const [seo, sold, locks] = await Promise.all([
      db.seoMeta.findMany({ where: { path: productSeoPath(p.slug) } }),
      this.soldLast30Days([p.id], db),
      this.source.locks(db),
    ]);
    const name = localized(p.name);
    const relations = Object.fromEntries(
      RELATION_KINDS.map((k) => [
        k,
        p.related
          .filter((r) => r.kind === k)
          .map((r) => ({
            id: r.to.id,
            slug: r.to.slug,
            name: localized(r.to.name),
            status: r.to.status,
          })),
      ]),
    ) as AdminProductDto['relations'];
    return {
      id: p.id,
      slug: p.slug,
      type: p.type,
      status: p.status,
      seller: p.seller,
      name,
      subtitle: p.subtitle ? localized(p.subtitle) : null,
      shortDesc: localized(p.shortDesc),
      description: localized(p.description),
      howToApply: localized(p.howToApply),
      specs: specsOf(p.specs),
      badges: p.badges,
      surfaces: p.surfaces,
      videoUrl: p.videoUrl,
      coverageM2PerL: p.coverageM2PerL ? Number(p.coverageM2PerL) : null,
      dryTimeMinutes: p.dryTimeMinutes,
      isBestseller: p.isBestseller,
      bestsellerSort: p.bestsellerSort,
      categoryIds: p.categories.map((c) => c.categoryId),
      keywords: keywordsOf(p.searchText, baseSearchText(p)),
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: localized(v.label),
        colorHex: v.colorHex,
        volumeMl: v.volumeMl,
        priceSoum: tiyinToSoumInt(v.priceTiyin),
        compareAtSoum: v.compareAtTiyin === null ? null : tiyinToSoumInt(v.compareAtTiyin),
        ikpu: v.ikpu,
        ikpuMissing: !isValidIkpu(v.ikpu),
        packageCode: v.packageCode,
        vatPercent: v.vatPercent,
        barcode: v.barcode,
        weightGrams: v.weightGrams,
        stock: v.stock,
        reserved: v.reserved,
        available: availableQty(v),
        lowStockAt: v.lowStockAt,
        active: v.active,
        sort: v.sort,
        linkedToMoysklad: v.moyskladId !== null,
      })),
      images: p.images.map((i) => ({
        id: i.id,
        fileId: i.fileId,
        url: this.uploads.url(i.file.key),
        alt: localized(i.alt),
        width: i.file.width,
        height: i.file.height,
        sort: i.sort,
      })),
      relations,
      seo: Object.fromEntries(
        LOCALES.map((l) => {
          const row = seo.find((s) => s.locale === l);
          return [
            l,
            {
              title: row?.title ?? '',
              description: row?.description ?? '',
              effectiveTitle: row?.title || productSeoTitle(name[l] || name.uz, l),
            },
          ];
        }),
      ) as AdminProductDto['seo'],
      locks,
      sold30d: sold.get(p.id) ?? 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async create(actor: AuditActor, input: ProductCreateInput): Promise<AdminProductDto> {
    const slug = input.slug || slugify(input.name.uz);
    if (!slug) throw new DomainError('VALIDATION_FAILED', undefined, 'slug');
    const seller = await this.officialSeller();
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.assertCategories(tx, input.categoryIds);
        const created = await tx.product.create({
          data: {
            slug,
            type: input.type,
            status: 'DRAFT',
            sellerId: seller.id,
            name: input.name,
            shortDesc: { uz: '', ru: '' },
            description: { uz: '', ru: '' },
            badges: [],
            surfaces: [],
            searchText: baseSearchText({ name: input.name, shortDesc: null, variants: [] }),
            categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
          },
        });
        await this.claimPaths(tx, slug);
        await this.audit.record(
          actor,
          {
            action: 'product.create',
            entity: 'Product',
            entityId: created.id,
            after: { slug, name: input.name, type: input.type, categoryIds: input.categoryIds },
          },
          tx,
        );
        return created.id;
      });
      return this.get(id);
    } catch (e) {
      throw mapUniqueError(e);
    }
  }

  async update(actor: AuditActor, id: string, input: ProductUpdateInput): Promise<AdminProductDto> {
    let heroMoved = false;
    const seen = { slugs: [] as string[], wasPublic: false };
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockProduct(tx, id);
        const before = await tx.product.findUnique({
          where: { id },
          include: { variants: true, categories: { select: { categoryId: true } } },
        });
        if (!before) throw new DomainError('PRODUCT_NOT_FOUND');
        seen.slugs.push(before.slug);
        seen.wasPublic = before.status === 'ACTIVE';

        const data: Prisma.ProductUpdateInput = {};
        const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
          before: {},
          after: {},
        };
        const note = (key: string, from: unknown, to: unknown) => {
          if (JSON.stringify(from) === JSON.stringify(to)) return false;
          diff.before[key] = from;
          diff.after[key] = to;
          return true;
        };

        for (const key of PLAIN_FIELDS) {
          const value = input[key];
          if (value === undefined) continue;
          const current = key === 'coverageM2PerL' ? numberOrNull(before[key]) : before[key];
          if (!note(key, current, value)) continue;
          (data as Record<string, unknown>)[key] =
            value === null && ['subtitle'].includes(key) ? Prisma.JsonNull : value;
        }

        if (input.status && note('status', before.status, input.status)) {
          if (input.status === 'ACTIVE') assertActivatable(before.variants);
          data.status = input.status;
        }

        const slug = input.slug ?? before.slug;
        if (note('slug', before.slug, slug)) {
          const taken = await tx.product.findUnique({ where: { slug }, select: { id: true } });
          if (taken) throw new DomainError('PRODUCT_SLUG_TAKEN', undefined, 'slug');
          data.slug = slug;
          if (await this.moveSlug(tx, before.slug, slug)) {
            heroMoved = true;
            note('homeHeroSlug', before.slug, slug);
          }
        }

        if (input.categoryIds) {
          const ids = [...new Set(input.categoryIds)];
          const current = before.categories.map((c) => c.categoryId).sort();
          if (note('categoryIds', current, [...ids].sort())) {
            await this.assertCategories(tx, ids);
            await tx.productCategory.deleteMany({ where: { productId: id } });
            await tx.productCategory.createMany({
              data: ids.map((categoryId) => ({ productId: id, categoryId })),
            });
          }
        }

        // searchText follows names/descriptions; extra keywords are preserved unless replaced.
        const oldBase = baseSearchText(before);
        const oldKeywords = keywordsOf(before.searchText, oldBase);
        const keywords = input.keywords
          ? [...new Set(input.keywords.map(normalizeSearch).filter(Boolean))]
          : oldKeywords;
        if (input.keywords) note('keywords', oldKeywords, keywords);
        const searchText = buildSearchText(
          baseSearchText({
            name: input.name ?? before.name,
            shortDesc: input.shortDesc ?? before.shortDesc,
            variants: before.variants,
          }),
          keywords,
        );
        if (searchText !== before.searchText) data.searchText = searchText;

        if (input.seo) {
          const changed = await this.saveSeo(tx, productSeoPath(slug), input.seo);
          if (changed) note('seo', changed.before, changed.after);
        }

        if (Object.keys(data).length > 0) {
          try {
            await tx.product.update({ where: { id }, data });
          } catch (e) {
            throw mapIkpuTrigger(e);
          }
        }
        await this.audit.record(
          actor,
          {
            action: 'product.update',
            entity: 'Product',
            entityId: id,
            before: diff.before,
            after: diff.after,
          },
          tx,
        );
      });
    } catch (e) {
      throw mapUniqueError(e);
    }
    if (heroMoved) this.settings.invalidate();
    void this.seoEvents.productChanged(id, seen);
    return this.get(id);
  }

  /** Only never-sold drafts can be deleted; everything else is archived (order history). */
  async remove(actor: AuditActor, id: string): Promise<void> {
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const p = await tx.product.findUnique({
        where: { id },
        include: {
          variants: { select: { id: true, sku: true, moyskladId: true } },
          images: true,
        },
      });
      if (!p) throw new DomainError('PRODUCT_NOT_FOUND');
      if (p.status !== 'DRAFT') throw new DomainError('PRODUCT_DELETE_NOT_DRAFT');
      // A MoySklad import would only come back on the next reconcile, without our content.
      if (
        p.variants.some((v) => v.moyskladId) &&
        (await this.source.locks(tx)).source === 'moysklad'
      )
        throw new DomainError('CATALOG_MOYSKLAD_READONLY');
      const variantIds = p.variants.map((v) => v.id);
      const [sold, reviews, inBundles] = await Promise.all([
        tx.orderItem.count({ where: { variantId: { in: variantIds } } }),
        tx.review.count({ where: { productId: id } }),
        tx.bundleItem.count({ where: { variantId: { in: variantIds }, bundleId: { not: id } } }),
      ]);
      if (sold > 0 || reviews > 0) throw new DomainError('PRODUCT_HAS_ORDERS');
      if (inBundles > 0) throw new DomainError('PRODUCT_VARIANT_IN_BUNDLE');
      await tx.cartItem.deleteMany({ where: { variantId: { in: variantIds } } });
      // Same as a variant delete: a gift code pointing at a removed variant stops working.
      await tx.promoCode.updateMany({
        where: { giftVariantId: { in: variantIds } },
        data: { giftVariantId: null, active: false },
      });
      await tx.favorite.deleteMany({ where: { productId: id } });
      await tx.seoMeta.deleteMany({ where: { path: productSeoPath(p.slug) } });
      await tx.product.delete({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'product.delete',
          entity: 'Product',
          entityId: id,
          before: { slug: p.slug, name: p.name, skus: p.variants.map((v) => v.sku) },
        },
        tx,
      );
      return { files: p.images.map((i) => i.fileId), slug: p.slug };
    });
    await this.uploads.discardUnreferenced(removed.files);
    void this.seoEvents.productChanged(id, { slugs: [removed.slug] });
  }

  async setRelations(
    actor: AuditActor,
    id: string,
    input: ProductRelationsInput,
  ): Promise<AdminProductDto> {
    const ids = [...new Set(input.productIds)].filter((x) => x !== id);
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const exists = await tx.product.count({ where: { id } });
      if (!exists) throw new DomainError('PRODUCT_NOT_FOUND');
      const found = await tx.product.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new DomainError('VALIDATION_FAILED', undefined, 'productIds');
      const before = await tx.productRelation.findMany({
        where: { fromId: id, kind: input.kind },
        orderBy: { sort: 'asc' },
        select: { toId: true },
      });
      await tx.productRelation.deleteMany({ where: { fromId: id, kind: input.kind } });
      await tx.productRelation.createMany({
        data: ids.map((toId, sort) => ({ fromId: id, toId, kind: input.kind, sort })),
      });
      await this.audit.record(
        actor,
        {
          action: 'product.relations_update',
          entity: 'Product',
          entityId: id,
          before: { kind: input.kind, productIds: before.map((r) => r.toId) },
          after: { kind: input.kind, productIds: ids },
        },
        tx,
      );
    });
    return this.changed(id);
  }

  /** Product options for relation pickers (all statuses; archived marked in the UI). */
  async options(): Promise<{ id: string; name: { uz: string; ru: string }; status: string }[]> {
    const rows = await this.prisma.product.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, status: true },
    });
    return rows.map((r) => ({ id: r.id, name: localized(r.name), status: r.status }));
  }

  // ───────── helpers ─────────

  private async officialSeller() {
    const seller = await this.prisma.seller.findFirst({
      where: { isOfficial: true, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!seller) throw new Error('Official seller missing — run pnpm db:seed');
    return seller;
  }

  private async assertCategories(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx.category.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size)
      throw new DomainError('VALIDATION_FAILED', undefined, 'categoryIds');
  }

  /** A new product path must resolve to the product: drop redirects that start there. */
  private async claimPaths(tx: Tx, slug: string): Promise<void> {
    const paths = LOCALES.flatMap((l) => redirectCandidates(`/${l}/p/${slug}`));
    await tx.redirect.deleteMany({ where: { from: { in: paths } } });
  }

  /**
   * docs/10 "301 for changed slugs automatically": old → new per locale, older redirects that
   * pointed at the old path follow (no chains), SEO rows move with the product.
   */
  private async moveSlug(tx: Tx, oldSlug: string, newSlug: string): Promise<boolean> {
    await this.claimPaths(tx, newSlug);
    for (const l of LOCALES)
      await saveRedirect(
        tx,
        { from: `/${l}/p/${oldSlug}`, to: `/${l}/p/${newSlug}`, code: 301 },
        { siteHost: null },
      );
    await tx.seoMeta.deleteMany({ where: { path: productSeoPath(newSlug) } });
    await tx.seoMeta.updateMany({
      where: { path: productSeoPath(oldSlug) },
      data: { path: productSeoPath(newSlug) },
    });
    return this.moveHeroSlug(tx, oldSlug, newSlug);
  }

  /** The home hero's "Shu natija uchun" card links by slug (`home.media`): follow the rename. */
  private async moveHeroSlug(tx: Tx, oldSlug: string, newSlug: string): Promise<boolean> {
    const row = await tx.setting.findUnique({ where: { key: 'home.media' } });
    const parsed = settingSchemas['home.media'].safeParse(row?.value);
    if (!parsed.success || parsed.data.hero?.productSlug !== oldSlug) return false;
    const value = { ...parsed.data, hero: { ...parsed.data.hero, productSlug: newSlug } };
    await tx.setting.update({ where: { key: 'home.media' }, data: { value } });
    return true;
  }

  /** Blank title and description = template → no row. Returns the diff when something changed. */
  private async saveSeo(
    tx: Tx,
    path: string,
    seo: NonNullable<ProductUpdateInput['seo']>,
  ): Promise<{ before: unknown; after: unknown } | null> {
    const rows = await tx.seoMeta.findMany({ where: { path } });
    const before: Record<string, { title: string; description: string }> = {};
    const after: Record<string, { title: string; description: string }> = {};
    for (const l of LOCALES) {
      const row = rows.find((r) => r.locale === l);
      const next = seo[l];
      before[l] = { title: row?.title ?? '', description: row?.description ?? '' };
      after[l] = next;
      if (!next.title && !next.description) {
        if (row) await tx.seoMeta.delete({ where: { id: row.id } });
      } else {
        await tx.seoMeta.upsert({
          where: { path_locale: { path, locale: l } },
          create: { path, locale: l, title: next.title, description: next.description },
          update: { title: next.title, description: next.description },
        });
      }
    }
    return JSON.stringify(before) === JSON.stringify(after) ? null : { before, after };
  }

  async soldLast30Days(ids: string[], db: Tx | PrismaService = this.prisma) {
    if (ids.length === 0) return new Map<string, number>();
    const since = new Date(Date.now() - 30 * DAY_MS);
    const rows = await db.$queryRaw<{ productId: string; qty: bigint }[]>`
      SELECT v."productId" AS "productId", SUM(oi."qty")::bigint AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Variant" v ON v."id" = oi."variantId"
      WHERE o."createdAt" >= ${since} AND o."status" <> 'CANCELLED'
        AND v."productId" IN (${Prisma.join(ids)})
      GROUP BY v."productId"`;
    return new Map(rows.map((r) => [r.productId, Number(r.qty)]));
  }
}

export async function lockProduct(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
}

/** docs/04 invariant 1, surfaced before the DB trigger: every active variant has a valid IKPU. */
export function assertActivatable(
  variants: readonly { sku: string; active: boolean; ikpu: string | null; priceTiyin: bigint }[],
): void {
  const active = variants.filter((v) => v.active);
  if (active.length === 0) throw new DomainError('PRODUCT_LAST_VARIANT', undefined, 'status');
  const missing = active.filter((v) => !isValidIkpu(v.ikpu)).map((v) => v.sku);
  if (missing.length > 0)
    throw new DomainError('PRODUCT_IKPU_REQUIRED', { skus: missing.join(', ') }, 'status');
  const free = active.filter((v) => v.priceTiyin < MIN_PRICE_TIYIN).map((v) => v.sku);
  if (free.length > 0)
    throw new DomainError('PRODUCT_PRICE_REQUIRED', { skus: free.join(', ') }, 'status');
}

/** An active variant is never sold for less than 1 so'm (a 0 price would be a free checkout). */
export const MIN_PRICE_TIYIN = soumToTiyin(1);

/** The constraints migration's IKPU triggers raise check_violation with these texts. */
export function mapIkpuTrigger(e: unknown): unknown {
  const msg = e instanceof Error ? e.message : '';
  if (/cannot be ACTIVE: a variant has no IKPU|of an ACTIVE product must have IKPU/.test(msg))
    return new DomainError('PRODUCT_IKPU_REQUIRED', { skus: '' }, 'ikpu');
  return e;
}

export function mapUniqueError(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = JSON.stringify(e.meta?.target ?? '');
    if (target.includes('sku')) return new DomainError('PRODUCT_SKU_TAKEN', undefined, 'sku');
    if (target.includes('slug')) return new DomainError('PRODUCT_SLUG_TAKEN', undefined, 'slug');
  }
  return e;
}

function numberOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export type { RelationKind };
