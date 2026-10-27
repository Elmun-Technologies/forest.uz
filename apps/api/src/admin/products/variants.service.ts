import { Injectable } from '@nestjs/common';
import {
  type AdminProductDto,
  DomainError,
  type IdOrderInput,
  isValidIkpu,
  soumToTiyin,
  tiyinToSoumInt,
  type VariantCreateInput,
  type VariantUpdateInput,
} from '@forest/contracts';
import type { Prisma, Variant } from '@forest/db';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { CatalogSourceService } from './catalog-source.service';
import { baseSearchText, buildSearchText, keywordsOf } from './product-text';
import {
  AdminProductsService,
  lockProduct,
  mapIkpuTrigger,
  MIN_PRICE_TIYIN,
  mapUniqueError,
} from './products.service';

type Tx = Prisma.TransactionClient;

/** Audit/diff view of a variant: money as so'm, the rest as stored. */
function snapshot(v: Variant) {
  return {
    sku: v.sku,
    label: v.label,
    colorHex: v.colorHex,
    volumeMl: v.volumeMl,
    priceSoum: tiyinToSoumInt(v.priceTiyin),
    compareAtSoum: v.compareAtTiyin === null ? null : tiyinToSoumInt(v.compareAtTiyin),
    ikpu: v.ikpu,
    packageCode: v.packageCode,
    vatPercent: v.vatPercent,
    barcode: v.barcode,
    weightGrams: v.weightGrams,
    stock: v.stock,
    lowStockAt: v.lowStockAt,
    active: v.active,
    sort: v.sort,
  };
}

/**
 * A11 "Variantlar": SKU, IKPU, price (so'm in, tiyin stored), stock. Price/stock follow the MoySklad
 * locks; an ACTIVE product never gets an active variant without a valid IKPU.
 */
@Injectable()
export class AdminVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly source: CatalogSourceService,
    private readonly settings: SettingsService,
    private readonly products: AdminProductsService,
  ) {}

  async create(
    actor: AuditActor,
    productId: string,
    input: VariantCreateInput,
  ): Promise<AdminProductDto> {
    const rules = await this.settings.get('catalog.rules');
    try {
      await this.prisma.$transaction(async (tx) => {
        if ((await this.source.locks(tx)).source === 'moysklad')
          throw new DomainError('CATALOG_MOYSKLAD_READONLY');
        await lockProduct(tx, productId);
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: { variants: true },
        });
        if (!product) throw new DomainError('PRODUCT_NOT_FOUND');
        if (product.status === 'ACTIVE' && input.active && !isValidIkpu(input.ikpu))
          throw new DomainError('PRODUCT_IKPU_REQUIRED', { skus: input.sku }, 'ikpu');
        assertCompareAt(input.priceSoum, input.compareAtSoum);
        if (input.active && input.priceSoum < 1)
          throw new DomainError('PRODUCT_PRICE_REQUIRED', { skus: input.sku }, 'priceSoum');
        const created = await tx.variant.create({
          data: {
            productId,
            sku: input.sku,
            label: input.label,
            colorHex: input.colorHex,
            volumeMl: input.volumeMl,
            priceTiyin: soumToTiyin(input.priceSoum),
            compareAtTiyin: input.compareAtSoum === null ? null : soumToTiyin(input.compareAtSoum),
            ikpu: input.ikpu,
            packageCode: input.packageCode,
            vatPercent: input.vatPercent,
            barcode: input.barcode,
            weightGrams: input.weightGrams,
            stock: input.stock,
            lowStockAt: input.lowStockAt ?? rules.lowStockDefault,
            active: input.active,
            sort: product.variants.reduce((m, v) => Math.max(m, v.sort + 1), 0),
          },
        });
        await syncSearchText(tx, product, product.variants, [...product.variants, created]);
        await this.audit.record(
          actor,
          {
            action: 'variant.create',
            entity: 'Variant',
            entityId: created.id,
            after: snapshot(created),
          },
          tx,
        );
      });
    } catch (e) {
      throw mapIkpuTrigger(mapUniqueError(e));
    }
    return this.products.changed(productId);
  }

  async update(
    actor: AuditActor,
    variantId: string,
    input: VariantUpdateInput,
  ): Promise<AdminProductDto> {
    const productId = await this.productIdOf(variantId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockProduct(tx, productId);
        const product = await tx.product.findUniqueOrThrow({
          where: { id: productId },
          include: { variants: true },
        });
        const before = product.variants.find((v) => v.id === variantId);
        if (!before) throw new DomainError('NOT_FOUND');
        const locks = await this.source.locks(tx);

        const data: Prisma.VariantUpdateInput = {};
        const changed = (key: keyof typeof input, current: unknown) =>
          input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current);
        const prev = snapshot(before);
        for (const key of [
          'sku',
          'label',
          'colorHex',
          'volumeMl',
          'ikpu',
          'packageCode',
          'vatPercent',
          'barcode',
          'weightGrams',
          'lowStockAt',
          'active',
        ] as const) {
          if (changed(key, prev[key])) (data as Record<string, unknown>)[key] = input[key];
        }
        // The MoySklad reconcile re-SKUs and re-activates linked variants: edits here would be
        // silently undone, so they are made (or archived) in MoySklad.
        if (
          locks.source === 'moysklad' &&
          before.moyskladId &&
          (changed('sku', prev.sku) || changed('active', prev.active))
        )
          throw new DomainError(
            'CATALOG_MOYSKLAD_READONLY',
            undefined,
            changed('sku', prev.sku) ? 'sku' : 'active',
          );
        const priceChanged = changed('priceSoum', prev.priceSoum);
        const compareChanged = changed('compareAtSoum', prev.compareAtSoum);
        if ((priceChanged || compareChanged) && locks.price)
          throw new DomainError('CATALOG_MOYSKLAD_READONLY', undefined, 'priceSoum');
        if (changed('stock', prev.stock)) {
          if (locks.stock) throw new DomainError('CATALOG_MOYSKLAD_READONLY', undefined, 'stock');
          data.stock = input.stock;
        }
        const price = input.priceSoum ?? prev.priceSoum;
        const compareAt =
          input.compareAtSoum !== undefined ? input.compareAtSoum : prev.compareAtSoum;
        if (priceChanged || compareChanged) assertCompareAt(price, compareAt);
        // Only the changed column is written: the DTO rounds tiyin to so'm, so rewriting an
        // untouched price from it could change a (MoySklad) price with tiyin.
        if (priceChanged) data.priceTiyin = soumToTiyin(price);
        if (compareChanged)
          data.compareAtTiyin = compareAt === null ? null : soumToTiyin(compareAt);

        const after = { ...before, ...data } as Variant;
        if (
          after.active &&
          after.priceTiyin < MIN_PRICE_TIYIN &&
          (priceChanged || (!before.active && after.active))
        )
          throw new DomainError('PRODUCT_PRICE_REQUIRED', { skus: after.sku }, 'priceSoum');
        if (product.status === 'ACTIVE') {
          const others = product.variants.filter((v) => v.id !== variantId && v.active);
          if (before.active && after.active === false && others.length === 0)
            throw new DomainError('PRODUCT_LAST_VARIANT', undefined, 'active');
          const ikpuTouched = 'ikpu' in data || ('active' in data && after.active);
          if (after.active && ikpuTouched && !isValidIkpu(after.ikpu))
            throw new DomainError('PRODUCT_IKPU_REQUIRED', { skus: after.sku }, 'ikpu');
        }
        if (Object.keys(data).length === 0) {
          await this.audit.record(
            actor,
            { action: 'variant.update', entity: 'Variant', entityId: variantId, after: {} },
            tx,
          );
          return;
        }
        const saved = await tx.variant.update({ where: { id: variantId }, data });
        await syncSearchText(
          tx,
          product,
          product.variants,
          product.variants.map((v) => (v.id === variantId ? saved : v)),
        );
        const next = snapshot(saved);
        const keys = (Object.keys(next) as (keyof typeof next)[]).filter(
          (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
        );
        await this.audit.record(
          actor,
          {
            action: 'variant.update',
            entity: 'Variant',
            entityId: variantId,
            before: Object.fromEntries(keys.map((k) => [k, prev[k]])),
            after: Object.fromEntries(keys.map((k) => [k, next[k]])),
          },
          tx,
        );
      });
    } catch (e) {
      throw mapIkpuTrigger(mapUniqueError(e));
    }
    return this.products.changed(productId);
  }

  /** Never-sold variants only; a sold one is deactivated instead (order history keeps it). */
  async remove(actor: AuditActor, variantId: string): Promise<AdminProductDto> {
    const productId = await this.productIdOf(variantId);
    await this.prisma.$transaction(async (tx) => {
      if ((await this.source.locks(tx)).source === 'moysklad')
        throw new DomainError('CATALOG_MOYSKLAD_READONLY');
      await lockProduct(tx, productId);
      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: { variants: true },
      });
      const v = product.variants.find((x) => x.id === variantId);
      if (!v) throw new DomainError('NOT_FOUND');
      const [sold, inBundle] = await Promise.all([
        tx.orderItem.count({ where: { variantId } }),
        tx.bundleItem.count({ where: { variantId } }),
      ]);
      if (sold > 0) throw new DomainError('PRODUCT_HAS_ORDERS');
      if (inBundle > 0) throw new DomainError('PRODUCT_VARIANT_IN_BUNDLE');
      const othersActive = product.variants.some((x) => x.id !== variantId && x.active);
      if (product.status === 'ACTIVE' && v.active && !othersActive)
        throw new DomainError('PRODUCT_LAST_VARIANT');
      await tx.cartItem.deleteMany({ where: { variantId } });
      await tx.promoCode.updateMany({
        where: { giftVariantId: variantId },
        data: { giftVariantId: null, active: false },
      });
      await tx.variant.delete({ where: { id: variantId } });
      await syncSearchText(
        tx,
        product,
        product.variants,
        product.variants.filter((x) => x.id !== variantId),
      );
      await this.audit.record(
        actor,
        { action: 'variant.delete', entity: 'Variant', entityId: variantId, before: snapshot(v) },
        tx,
      );
    });
    return this.products.changed(productId);
  }

  async reorder(
    actor: AuditActor,
    productId: string,
    input: IdOrderInput,
  ): Promise<AdminProductDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, productId);
      const variants = await tx.variant.findMany({
        where: { productId },
        select: { id: true },
        orderBy: { sort: 'asc' },
      });
      assertPermutation(
        variants.map((v) => v.id),
        input.ids,
      );
      for (const [sort, id] of input.ids.entries())
        await tx.variant.update({ where: { id }, data: { sort } });
      await this.audit.record(
        actor,
        {
          action: 'variant.reorder',
          entity: 'Product',
          entityId: productId,
          before: { ids: variants.map((v) => v.id) },
          after: { ids: input.ids },
        },
        tx,
      );
    });
    return this.products.changed(productId);
  }

  private async productIdOf(variantId: string): Promise<string> {
    const v = await this.prisma.variant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!v) throw new DomainError('NOT_FOUND');
    return v.productId;
  }
}

function assertCompareAt(price: number, compareAt: number | null): void {
  if (compareAt !== null && compareAt <= price)
    throw new DomainError(
      'VALIDATION_FAILED',
      { reason: 'compare_at_not_above_price' },
      'compareAtSoum',
    );
}

/** `ids` must be exactly the existing ids, each once. */
export function assertPermutation(existing: readonly string[], ids: readonly string[]): void {
  const a = [...existing].sort();
  const b = [...ids].sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i]))
    throw new DomainError('VALIDATION_FAILED', undefined, 'ids');
}

/** Variant labels/SKUs are part of the search text; admin keywords survive the rebuild. */
async function syncSearchText(
  tx: Tx,
  product: { id: string; name: unknown; shortDesc: unknown; searchText: string },
  before: readonly Variant[],
  after: readonly Variant[],
): Promise<void> {
  const keywords = keywordsOf(
    product.searchText,
    baseSearchText({ ...product, variants: [...before] }),
  );
  const searchText = buildSearchText(
    baseSearchText({ ...product, variants: [...after] }),
    keywords,
  );
  if (searchText !== product.searchText)
    await tx.product.update({ where: { id: product.id }, data: { searchText } });
}
