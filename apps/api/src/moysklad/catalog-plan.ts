import { formatAmount } from '@forest/contracts';
import { bundleStock, normalizeIkpu, stockUnits } from '../integrations/providers/moysklad';
import type { InventoryItem } from '../integrations/providers/types';

/**
 * Pure planning of a MoySklad → site catalog sync (CLAUDE.md §6 conflict rules): which variants to
 * link/update/deactivate and which DRAFT products to create. The service applies the plan; keeping
 * the decisions here makes every rule unit-testable without a database.
 */

export interface LocalVariant {
  id: string;
  productId: string;
  sku: string;
  moyskladId: string | null;
  priceTiyin: bigint;
  stock: number;
  ikpu: string | null;
  active: boolean;
  productStatus: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  productType: 'SIMPLE' | 'BUNDLE';
  productMoyskladId: string | null;
}

export interface VariantPatch {
  variantId: string;
  sku: string;
  moyskladId?: string;
  /** Link the variant's product to its MoySklad product/bundle (Product.moyskladId). */
  product?: { id: string; moyskladId: string };
  newSku?: string;
  priceTiyin?: bigint;
  stock?: number;
  ikpu?: string;
  active?: boolean;
  /** Log lines (design: "FR-CW-1000: 319 000 → 329 000"). */
  notes: { kind: 'price' | 'stock' | 'product'; message: string }[];
}

export interface NewVariant {
  externalId: string;
  sku: string;
  label: string;
  priceTiyin: bigint;
  ikpu: string | null;
  stock: number;
  /** False when MoySklad has no usable price: never sellable at 0. */
  active: boolean;
}

export interface NewProduct {
  /** MoySklad product/bundle id (Product.moyskladId). */
  externalId: string;
  type: 'SIMPLE' | 'BUNDLE';
  name: string;
  /** Our product to attach to (its MoySklad product is already linked), else create a DRAFT. */
  existingProductId: string | null;
  variants: NewVariant[];
}

export interface BundleComposition {
  /** MoySklad bundle id → our BUNDLE product (via its kit variant). */
  bundleExternalId: string;
  components: { externalId: string; qty: number }[];
}

export interface CatalogPlan {
  patches: VariantPatch[];
  creates: NewProduct[];
  bundles: BundleComposition[];
  errors: string[];
  /** Sellable MoySklad units seen (for the "N SKU tekshirildi" summary). */
  checked: number;
  stockRejected: boolean;
}

export interface PlanInput {
  items: InventoryItem[];
  /** Free stock per assortment id; null = stock not synced in this run. */
  stock: ReadonlyMap<string, number> | null;
  local: LocalVariant[];
  /** Our Product id per linked MoySklad product/bundle id. */
  productsByExternalId: ReadonlyMap<string, string>;
  prices: boolean;
  /** Full pull: linked variants missing from MoySklad are deactivated. */
  full: boolean;
}

const money = (t: bigint) => formatAmount(t);

/** Products with modifications are sold through their variants; the rest are sellable units. */
export function sellableUnits(items: InventoryItem[]): InventoryItem[] {
  return items.filter((i) => i.type !== 'product' || !i.hasVariants);
}

/** Stock of a unit; null when the report doesn't mention it (or one of a kit's components). */
export function unitStock(
  item: { type: string; externalId: string; components: { externalId: string; qty: number }[] },
  stock: ReadonlyMap<string, number>,
): number | null {
  if (item.type === 'bundle')
    return item.components.length && item.components.every((c) => stock.has(c.externalId))
      ? bundleStock(item.components, stock)
      : null;
  const v = stock.get(item.externalId);
  return v === undefined ? null : stockUnits(v);
}

/**
 * A stock report that is empty or misses more than half of the ids we expect is not trusted:
 * applying it would zero the catalog (an outage, a wrong store, a non-admin token).
 */
export function stockReportProblem(
  stock: ReadonlyMap<string, number>,
  expectedIds: readonly string[],
): string | null {
  if (!expectedIds.length) return null;
  if (stock.size === 0) return "Qoldiq hisoboti bo'sh — qoldiqlar o'zgartirilmadi";
  const missing = expectedIds.filter((id) => !stock.has(id)).length;
  return missing * 2 > expectedIds.length
    ? `Qoldiq hisobotida ${missing}/${expectedIds.length} SKU yo'q — qoldiqlar o'zgartirilmadi`
    : null;
}

/** Why MoySklad's price can't be used (null = usable). */
function priceProblem(u: InventoryItem): string | null {
  if (u.priceCurrency && u.priceCurrency !== 'UZS')
    return `narx valyutasi ${u.priceCurrency} (UZS kerak)`;
  return u.priceTiyin === null ? "MoySklad'da narx yo'q" : null;
}

/** The IKPU guard (DB trigger): an active variant of an ACTIVE product must have an IKPU. */
function canBeActive(v: LocalVariant, ikpu: string | null): boolean {
  return v.productStatus !== 'ACTIVE' || Boolean(ikpu);
}

export function planCatalogSync(input: PlanInput): CatalogPlan {
  const plan: CatalogPlan = {
    patches: [],
    creates: [],
    bundles: [],
    errors: [],
    checked: 0,
    stockRejected: false,
  };
  const byMsId = new Map(
    input.local.filter((v) => v.moyskladId).map((v) => [v.moyskladId!, v] as const),
  );
  const bySku = new Map(input.local.map((v) => [v.sku, v] as const));
  const productNames = new Map(
    input.items.filter((i) => i.type === 'product').map((i) => [i.externalId, i.name] as const),
  );
  const seen = new Set<string>();
  const skusTaken = new Set(input.local.map((v) => v.sku));
  const creates = new Map<string, NewProduct>();
  const units = sellableUnits(input.items);
  const claimedProducts = new Set(input.productsByExternalId.keys());
  /** MoySklad product id → our product, learnt from variants linked in this run. */
  const linkedParents = new Map<string, string>();

  let stock = input.stock;
  if (stock) {
    const expected = units
      .filter((u) => u.type !== 'bundle' && !u.archived)
      .map((u) => u.externalId);
    const problem = stockReportProblem(stock, expected);
    if (problem) {
      plan.errors.push(problem);
      plan.stockRejected = true;
      stock = null;
    }
  }

  // Full pull answered with nothing while we have links: a broken account/filter, not a wipe.
  if (input.full && units.length === 0 && byMsId.size > 0) {
    plan.errors.push("MoySklad bo'sh ro'yxat qaytardi — variantlar o'chirilmadi");
    return plan;
  }

  for (const u of units) {
    plan.checked++;
    if (u.type === 'bundle')
      plan.bundles.push({ bundleExternalId: u.externalId, components: u.components });
    let local = byMsId.get(u.externalId);
    if (!local && u.sku) {
      const candidate = bySku.get(u.sku);
      // Never steal a variant already linked to another MoySklad item.
      if (candidate && !candidate.moyskladId) local = candidate;
      else if (candidate)
        plan.errors.push(`${u.sku}: SKU boshqa MoySklad pozitsiyasiga bog'langan`);
    }
    const ikpu = normalizeIkpu(u.ikpu);
    if (u.ikpu && !ikpu)
      plan.errors.push(`${u.sku ?? u.name}: IKPU noto'g'ri (${u.ikpu.slice(0, 30)})`);
    if (u.archived) {
      if (local?.active)
        plan.patches.push({
          variantId: local.id,
          sku: local.sku,
          ...(local.moyskladId ? {} : { moyskladId: u.externalId }),
          active: false,
          notes: [{ kind: 'product', message: `${local.sku}: MoySklad'da arxivda → o'chirildi` }],
        });
      continue;
    }
    seen.add(u.externalId);

    if (local) {
      const patch: VariantPatch = { variantId: local.id, sku: local.sku, notes: [] };
      if (!local.moyskladId) {
        patch.moyskladId = u.externalId;
        patch.notes.push({ kind: 'product', message: `${local.sku}: MoySklad bilan bog'landi` });
      }
      if (u.sku && u.sku !== local.sku) {
        if (skusTaken.has(u.sku))
          plan.errors.push(`${local.sku} → ${u.sku}: bu SKU saytda boshqa variantda bor`);
        else {
          patch.newSku = u.sku;
          skusTaken.delete(local.sku);
          skusTaken.add(u.sku);
          patch.notes.push({ kind: 'product', message: `SKU ${local.sku} → ${u.sku}` });
        }
      }
      const label = patch.newSku ?? local.sku;
      const groupId = u.type === 'variant' ? u.parentExternalId! : u.externalId;
      if (!local.productMoyskladId && !claimedProducts.has(groupId)) {
        claimedProducts.add(groupId);
        patch.product = { id: local.productId, moyskladId: groupId };
      }
      if (u.type === 'variant') linkedParents.set(groupId, local.productId);
      const noPrice = priceProblem(u);
      if (input.prices && noPrice)
        plan.errors.push(`${label}: ${noPrice} — saytdagi narx o'zgarmadi`);
      else if (input.prices && u.priceTiyin !== null && u.priceTiyin !== local.priceTiyin) {
        patch.priceTiyin = u.priceTiyin;
        patch.notes.push({
          kind: 'price',
          message: `${label}: ${money(local.priceTiyin)} → ${money(u.priceTiyin)}`,
        });
      }
      if (ikpu && ikpu !== local.ikpu) {
        patch.ikpu = ikpu;
        patch.notes.push({ kind: 'product', message: `${label}: IKPU yangilandi` });
      }
      if (stock) {
        const s = unitStock(u, stock);
        if (s !== null && s !== local.stock) {
          patch.stock = s;
          patch.notes.push({ kind: 'stock', message: `${label}: ${local.stock} → ${s}` });
        }
      }
      if (!local.active) {
        if ((patch.priceTiyin ?? local.priceTiyin) <= 0n)
          plan.errors.push(`${label}: narx yo'q — variant yoqilmadi`);
        else if (canBeActive(local, ikpu ?? local.ikpu)) {
          patch.active = true;
          patch.notes.push({ kind: 'product', message: `${label}: MoySklad'da bor → yoqildi` });
        } else plan.errors.push(`${label}: IKPU yo'q — variant yoqilmadi`);
      }
      if (patch.notes.length || patch.product) plan.patches.push(patch);
      continue;
    }

    // New in MoySklad: a DRAFT product that needs our content (docs/02).
    if (!u.sku) {
      plan.errors.push(`${u.name}: MoySklad'da artikul/kod yo'q — qo'shilmadi`);
      continue;
    }
    if (skusTaken.has(u.sku)) continue; // reported above (linked elsewhere)
    skusTaken.add(u.sku);
    const groupId = u.type === 'variant' ? u.parentExternalId! : u.externalId;
    let group = creates.get(groupId);
    if (!group) {
      group = {
        externalId: groupId,
        type: u.type === 'bundle' ? 'BUNDLE' : 'SIMPLE',
        name: (u.type === 'variant' ? productNames.get(groupId) : undefined) ?? u.name,
        existingProductId: input.productsByExternalId.get(groupId) ?? null,
        variants: [],
      };
      creates.set(groupId, group);
    }
    const noPrice = priceProblem(u);
    if (noPrice)
      plan.errors.push(`${u.sku}: ${noPrice} — yangi variant o'chirilgan holda qo'shildi`);
    group.variants.push({
      externalId: u.externalId,
      sku: u.sku,
      label: u.label ?? '—',
      priceTiyin: noPrice ? 0n : u.priceTiyin!,
      ikpu,
      stock: (stock ? unitStock(u, stock) : null) ?? 0,
      active: !noPrice,
    });
  }
  // A new modification of a product whose sibling was linked by SKU joins that product.
  for (const g of creates.values()) g.existingProductId ??= linkedParents.get(g.externalId) ?? null;
  plan.creates = [...creates.values()];

  if (input.full) {
    for (const v of byMsId.values()) {
      if (seen.has(v.moyskladId!) || !v.active) continue;
      if (plan.patches.some((p) => p.variantId === v.id)) continue;
      plan.patches.push({
        variantId: v.id,
        sku: v.sku,
        active: false,
        notes: [{ kind: 'product', message: `${v.sku}: MoySklad'da yo'q → o'chirildi` }],
      });
    }
  }
  return plan;
}

/**
 * Stock-only poll: linked variants' new stock (kits from their stored composition). Ids missing
 * from the report keep their stock; an untrustworthy report changes nothing.
 */
export function planStockUpdates(
  local: {
    id: string;
    sku: string;
    moyskladId: string;
    stock: number;
    bundle: { externalId: string; qty: number }[] | null;
  }[],
  stock: ReadonlyMap<string, number>,
): {
  updates: { variantId: string; sku: string; from: number; to: number }[];
  error: string | null;
} {
  const error = stockReportProblem(
    stock,
    local.filter((v) => !v.bundle).map((v) => v.moyskladId),
  );
  if (error) return { updates: [], error };
  const updates: { variantId: string; sku: string; from: number; to: number }[] = [];
  for (const v of local) {
    const to = v.bundle
      ? unitStock({ type: 'bundle', externalId: v.moyskladId, components: v.bundle }, stock)
      : unitStock({ type: 'product', externalId: v.moyskladId, components: [] }, stock);
    if (to !== null && to !== v.stock)
      updates.push({ variantId: v.id, sku: v.sku, from: v.stock, to });
  }
  return { updates, error: null };
}
