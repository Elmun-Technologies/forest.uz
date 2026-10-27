import { Injectable } from '@nestjs/common';
import { normalizeSearch, slugify } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { IntegrationsService } from '../integrations/integrations.service';
import type { InventoryItem, InventoryItemType } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CatalogPlan,
  type LocalVariant,
  type NewProduct,
  planCatalogSync,
  planStockUpdates,
  sellableUnits,
} from './catalog-plan';
import type { MoyskladLease } from './moysklad-lock';
import { MoyskladLogService } from './moysklad-log.service';
import { mappingOf, type MoyskladState } from './moysklad-settings.service';

/** Detail rows per run; the rest are counted in one summary row. */
const LOG_CAP = 100;

export interface CatalogSyncSummary {
  checked: number;
  changed: number;
  created: number;
  errors: number;
  /** The stock report was not trusted (empty / mostly missing). */
  stockRejected: boolean;
}

const UNIQUE_VIOLATION = 'P2002';

/**
 * MoySklad → site catalog: full pull (hourly reconciliation and "sync now"), targeted refresh
 * (webhooks) and the stock poll. Rules are decided by `planCatalogSync` (pure); this service loads
 * our rows, applies the plan and writes the sync log. Callers hold the MoySklad lock.
 */
@Injectable()
export class CatalogSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly log: MoyskladLogService,
  ) {}

  private async localVariants(): Promise<LocalVariant[]> {
    const rows = await this.prisma.variant.findMany({
      select: {
        id: true,
        productId: true,
        sku: true,
        moyskladId: true,
        priceTiyin: true,
        stock: true,
        ikpu: true,
        active: true,
        product: { select: { status: true, type: true, moyskladId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      sku: r.sku,
      moyskladId: r.moyskladId,
      priceTiyin: r.priceTiyin,
      stock: r.stock,
      ikpu: r.ikpu,
      active: r.active,
      productStatus: r.product.status,
      productType: r.product.type,
      productMoyskladId: r.product.moyskladId,
    }));
  }

  private async productsByExternalId(): Promise<Map<string, string>> {
    const rows = await this.prisma.product.findMany({
      where: { moyskladId: { not: null } },
      select: { id: true, moyskladId: true },
    });
    return new Map(rows.map((r) => [r.moyskladId!, r.id]));
  }

  /** Full pull: products, variants, bundles, prices, stock, deletions. */
  async pullAll(state: MoyskladState, lease?: MoyskladLease): Promise<CatalogSyncSummary> {
    const { settings } = state;
    const provider = await this.integrations.inventory();
    const items = await provider.listAssortment(mappingOf(settings));
    const stock = settings.flows.stock ? await provider.stockLevels(settings.storeId) : null;
    await this.log.rememberTypes(items);
    const summary = await this.applyItems(items, stock, state, true, lease);
    await this.log.markSynced('catalog');
    if (stock && !summary.stockRejected) await this.log.markSynced('stock');
    const ok = summary.errors === 0;
    await this.log.log(
      'product',
      ok,
      summary.changed || summary.created
        ? `${summary.checked} SKU tekshirildi: ${summary.changed} o'zgardi, ${summary.created} yangi`
        : `${summary.checked} SKU tekshirildi, o'zgarish yo'q`,
    );
    return summary;
  }

  /** Webhook: one MoySklad entity (a product brings its variants); gone → deactivated. */
  async refreshItem(
    state: MoyskladState,
    type: InventoryItemType,
    externalId: string,
    lease?: MoyskladLease,
  ): Promise<CatalogSyncSummary> {
    const provider = await this.integrations.inventory();
    const items = await provider.getItem(type, externalId, mappingOf(state.settings));
    if (items === null) return this.deactivateDeleted(externalId, lease);
    const ids = sellableUnits(items).map((i) => i.externalId);
    const stock = state.settings.flows.stock
      ? await provider.stockLevels(state.settings.storeId)
      : null;
    await this.log.rememberTypes(items);
    const summary = await this.applyItems(items, stock, state, false, lease);
    if (!summary.changed && !summary.created && !summary.errors)
      await this.log.log('product', true, `Webhook: ${ids.length} SKU tekshirildi, o'zgarish yo'q`);
    return summary;
  }

  private async deactivateDeleted(
    externalId: string,
    lease?: MoyskladLease,
  ): Promise<CatalogSyncSummary> {
    const variants = await this.prisma.variant.findMany({
      where: {
        active: true,
        OR: [{ moyskladId: externalId }, { product: { moyskladId: externalId } }],
      },
      select: { id: true, sku: true },
    });
    for (const v of variants) {
      lease?.assertHeld();
      await this.prisma.variant.update({ where: { id: v.id }, data: { active: false } });
      await this.log.log('product', true, `${v.sku}: MoySklad'dan o'chirilgan → o'chirildi`);
    }
    return {
      checked: variants.length,
      changed: variants.length,
      created: 0,
      errors: 0,
      stockRejected: false,
    };
  }

  private async applyItems(
    items: InventoryItem[],
    stock: ReadonlyMap<string, number> | null,
    state: MoyskladState,
    full: boolean,
    lease?: MoyskladLease,
  ): Promise<CatalogSyncSummary> {
    const plan = planCatalogSync({
      items,
      stock,
      local: await this.localVariants(),
      productsByExternalId: await this.productsByExternalId(),
      prices: state.settings.flows.prices,
      full,
    });
    return this.apply(plan, lease);
  }

  private async apply(plan: CatalogPlan, lease?: MoyskladLease): Promise<CatalogSyncSummary> {
    const rows: { kind: 'product' | 'price' | 'stock'; ok: boolean; message: string }[] = [];
    const errors = [...plan.errors];
    let changed = 0;
    for (const p of plan.patches) {
      lease?.assertHeld();
      try {
        if (p.product) await this.linkProduct(p.product.id, p.product.moyskladId);
        await this.prisma.variant.update({
          where: { id: p.variantId },
          data: {
            ...(p.moyskladId ? { moyskladId: p.moyskladId } : {}),
            ...(p.newSku ? { sku: p.newSku } : {}),
            ...(p.priceTiyin !== undefined ? { priceTiyin: p.priceTiyin } : {}),
            ...(p.stock !== undefined ? { stock: p.stock } : {}),
            ...(p.ikpu ? { ikpu: p.ikpu } : {}),
            ...(p.active !== undefined ? { active: p.active } : {}),
          },
        });
        changed++;
        rows.push(...p.notes.map((n) => ({ ...n, ok: true })));
      } catch (e) {
        errors.push(`${p.sku}: ${dbError(e)}`);
      }
    }
    let created = 0;
    for (const c of plan.creates) {
      lease?.assertHeld();
      try {
        created += await this.create(c);
        rows.push(
          ...c.variants.map((v) => ({
            kind: 'product' as const,
            ok: true,
            message: `${v.sku}: yangi mahsulot (qoralama) — kontent kerak`,
          })),
        );
      } catch (e) {
        errors.push(`${c.variants.map((v) => v.sku).join(', ')}: ${dbError(e)}`);
      }
    }
    for (const b of plan.bundles) {
      lease?.assertHeld();
      const problem = await this.applyBundle(b.bundleExternalId, b.components);
      if (problem) errors.push(problem);
    }
    await this.log.logMany(
      [...rows, ...errors.map((message) => ({ kind: 'product' as const, ok: false, message }))],
      LOG_CAP,
    );
    return {
      checked: plan.checked,
      changed,
      created,
      errors: errors.length,
      stockRejected: plan.stockRejected,
    };
  }

  /**
   * Product.moyskladId for a product linked by SKU, so later modifications of that MoySklad product
   * join it. Skipped when another product already holds the id (unique).
   */
  private async linkProduct(productId: string, moyskladId: string): Promise<void> {
    try {
      await this.prisma.product.updateMany({
        where: { id: productId, moyskladId: null },
        data: { moyskladId },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION))
        throw e;
    }
  }

  private async officialSellerId(): Promise<string> {
    const seller = await this.prisma.seller.findFirst({
      where: { isOfficial: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!seller) throw new Error('official seller missing (run the seed)');
    return seller.id;
  }

  private async uniqueSlug(name: string, externalId: string): Promise<string> {
    const base = (slugify(name) || 'mahsulot').slice(0, 80);
    const taken = await this.prisma.product.findUnique({
      where: { slug: base },
      select: { id: true },
    });
    return taken ? `${base}-${externalId.slice(0, 8)}` : base;
  }

  /** New MoySklad item(s): a DRAFT product (or an existing one, for a new modification). */
  private async create(c: NewProduct): Promise<number> {
    const sellerId = c.existingProductId ? null : await this.officialSellerId();
    const slug = c.existingProductId ? null : await this.uniqueSlug(c.name, c.externalId);
    await this.prisma.$transaction(async (tx) => {
      const productId =
        c.existingProductId ??
        (
          await tx.product.create({
            data: {
              slug: slug!,
              type: c.type,
              status: 'DRAFT',
              sellerId: sellerId!,
              // Placeholder until content is written (names are ours after creation, docs/02).
              name: { uz: c.name, ru: c.name },
              searchText: normalizeSearch(`${c.name} ${c.variants.map((v) => v.sku).join(' ')}`),
              moyskladId: c.externalId,
            },
            select: { id: true },
          })
        ).id;
      for (const [i, v] of c.variants.entries())
        await tx.variant.create({
          data: {
            productId,
            sku: v.sku,
            label: { uz: v.label, ru: v.label },
            priceTiyin: v.priceTiyin,
            ikpu: v.ikpu,
            stock: v.stock,
            active: v.active,
            moyskladId: v.externalId,
            sort: i,
          },
        });
    });
    return c.variants.length;
  }

  /** Kit composition from MoySklad → BundleItem (components must be linked variants). */
  private async applyBundle(
    bundleExternalId: string,
    components: { externalId: string; qty: number }[],
  ): Promise<string | null> {
    const kit = await this.prisma.variant.findUnique({
      where: { moyskladId: bundleExternalId },
      select: { sku: true, productId: true, product: { select: { type: true } } },
    });
    if (!kit || kit.product.type !== 'BUNDLE') return null;
    const linked = await this.prisma.variant.findMany({
      where: { moyskladId: { in: components.map((c) => c.externalId) } },
      select: { id: true, moyskladId: true },
    });
    const byMs = new Map(linked.map((v) => [v.moyskladId!, v.id]));
    const missing = components.filter((c) => !byMs.has(c.externalId));
    const wanted = components
      .filter((c) => byMs.has(c.externalId))
      .map((c) => ({ variantId: byMs.get(c.externalId)!, qty: Math.max(1, Math.round(c.qty)) }));
    const current = await this.prisma.bundleItem.findMany({ where: { bundleId: kit.productId } });
    const same =
      current.length === wanted.length &&
      wanted.every((w) => current.some((c) => c.variantId === w.variantId && c.qty === w.qty));
    if (!same)
      await this.prisma.$transaction([
        this.prisma.bundleItem.deleteMany({ where: { bundleId: kit.productId } }),
        this.prisma.bundleItem.createMany({
          data: wanted.map((w) => ({ bundleId: kit.productId, ...w })),
        }),
      ]);
    if (!same) await this.log.log('product', true, `${kit.sku}: to'plam tarkibi yangilandi`);
    return missing.length
      ? `${kit.sku}: to'plam tarkibida saytga bog'lanmagan ${missing.length} ta pozitsiya`
      : null;
  }

  /** Stock poll: one snapshot for every linked variant (kits from their stored composition). */
  async pollStock(
    state: MoyskladState,
    opts: { manual?: boolean; lease?: MoyskladLease } = {},
  ): Promise<number> {
    const provider = await this.integrations.inventory();
    const stock = await provider.stockLevels(state.settings.storeId);
    const variants = await this.prisma.variant.findMany({
      where: { moyskladId: { not: null } },
      select: {
        id: true,
        sku: true,
        moyskladId: true,
        stock: true,
        productId: true,
        product: { select: { type: true } },
      },
    });
    const kitIds = variants.filter((v) => v.product.type === 'BUNDLE').map((v) => v.productId);
    const items = kitIds.length
      ? await this.prisma.bundleItem.findMany({
          where: { bundleId: { in: kitIds } },
          select: { bundleId: true, qty: true, variant: { select: { moyskladId: true } } },
        })
      : [];
    const compositions = new Map<string, { externalId: string; qty: number }[]>();
    for (const i of items) {
      if (!i.variant.moyskladId) continue;
      const list = compositions.get(i.bundleId) ?? [];
      list.push({ externalId: i.variant.moyskladId, qty: i.qty });
      compositions.set(i.bundleId, list);
    }
    const { updates, error } = planStockUpdates(
      variants
        // A kit whose composition isn't linked yet keeps its stock until the next full pull.
        .filter((v) => v.product.type !== 'BUNDLE' || compositions.has(v.productId))
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          moyskladId: v.moyskladId!,
          stock: v.stock,
          bundle: v.product.type === 'BUNDLE' ? compositions.get(v.productId)! : null,
        })),
      stock,
    );
    if (error) {
      await this.log.log('stock', false, error);
      return 0;
    }
    for (const u of updates) {
      opts.lease?.assertHeld();
      await this.prisma.variant.update({ where: { id: u.variantId }, data: { stock: u.to } });
    }
    await this.log.markSynced('stock');
    await this.log.logMany(
      updates.map((u) => ({
        kind: 'stock' as const,
        ok: true,
        message: `${u.sku}: ${u.from} → ${u.to}`,
      })),
      LOG_CAP,
    );
    if (opts.manual && !updates.length)
      await this.log.log(
        'stock',
        true,
        `${variants.length} SKU qoldig'i tekshirildi, o'zgarish yo'q`,
      );
    return updates.length;
  }
}

function dbError(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION)
    return 'bu SKU yoki MoySklad ID saytda boshqa yozuvda bor';
  return String(e instanceof Error ? e.message : e).slice(0, 200);
}
