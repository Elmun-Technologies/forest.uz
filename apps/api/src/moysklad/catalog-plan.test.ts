import type { InventoryItem } from '../integrations/providers/types';
import { type LocalVariant, planCatalogSync, planStockUpdates } from './catalog-plan';

const IKPU = '03208001001000000';

function item(over: Partial<InventoryItem> & { externalId: string }): InventoryItem {
  return {
    type: 'product',
    parentExternalId: null,
    name: 'Chalk White',
    sku: null,
    ikpu: IKPU,
    priceTiyin: 32_900_000n,
    archived: false,
    hasVariants: false,
    label: null,
    components: [],
    ...over,
  };
}

function local(over: Partial<LocalVariant> & { id: string; sku: string }): LocalVariant {
  return {
    productId: 'p1',
    moyskladId: null,
    priceTiyin: 31_900_000n,
    stock: 5,
    ikpu: IKPU,
    active: true,
    productStatus: 'ACTIVE',
    productType: 'SIMPLE',
    ...over,
  };
}

const base = { productsByExternalId: new Map<string, string>(), prices: true, full: true };

describe('planCatalogSync', () => {
  it('links by SKU and lets MoySklad win price and stock (content is never touched)', () => {
    const plan = planCatalogSync({
      ...base,
      items: [item({ externalId: 'ms1', sku: 'FR-CW-1000' })],
      stock: new Map([['ms1', 4]]),
      local: [local({ id: 'v1', sku: 'FR-CW-1000' })],
    });
    expect(plan.patches).toHaveLength(1);
    const p = plan.patches[0]!;
    expect(p).toMatchObject({
      variantId: 'v1',
      moyskladId: 'ms1',
      priceTiyin: 32_900_000n,
      stock: 4,
    });
    expect(Object.keys(p)).not.toContain('name');
    expect(p.notes.map((n) => n.kind)).toEqual(['product', 'price', 'stock']);
    expect(p.notes[1]?.message).toBe('FR-CW-1000: 319 000 → 329 000');
    expect(plan.creates).toEqual([]);
  });

  it('keeps our price when the prices flow is off or MoySklad has no such price', () => {
    const items = [item({ externalId: 'ms1', sku: 'A', priceTiyin: null })];
    const l = [local({ id: 'v1', sku: 'A', moyskladId: 'ms1' })];
    expect(planCatalogSync({ ...base, items, stock: null, local: l }).patches).toEqual([]);
    const off = planCatalogSync({
      ...base,
      prices: false,
      items: [item({ externalId: 'ms1', sku: 'A' })],
      stock: null,
      local: l,
    });
    expect(off.patches).toEqual([]);
  });

  it('deactivates linked variants missing from or archived in MoySklad, never deletes', () => {
    const plan = planCatalogSync({
      ...base,
      items: [
        item({ externalId: 'ms1', sku: 'A', priceTiyin: 31_900_000n }),
        item({ externalId: 'ms2', sku: 'B', archived: true }),
      ],
      stock: null,
      local: [
        local({ id: 'v1', sku: 'A', moyskladId: 'ms1' }),
        local({ id: 'v2', sku: 'B', moyskladId: 'ms2' }),
        local({ id: 'v3', sku: 'C', moyskladId: 'gone' }),
        local({ id: 'v4', sku: 'D' }),
      ],
    });
    expect(plan.patches.map((p) => [p.variantId, p.active])).toEqual([
      ['v2', false],
      ['v3', false],
    ]);
  });

  it('does not deactivate anything when a full pull returns nothing', () => {
    const plan = planCatalogSync({
      ...base,
      items: [],
      stock: null,
      local: [local({ id: 'v1', sku: 'A', moyskladId: 'ms1' })],
    });
    expect(plan.patches).toEqual([]);
    expect(plan.errors).toHaveLength(1);
  });

  it('targeted refreshes never deactivate other variants', () => {
    const plan = planCatalogSync({
      ...base,
      full: false,
      items: [item({ externalId: 'ms1', sku: 'A', priceTiyin: 31_900_000n })],
      stock: null,
      local: [
        local({ id: 'v1', sku: 'A', moyskladId: 'ms1' }),
        local({ id: 'v3', sku: 'C', moyskladId: 'other' }),
      ],
    });
    expect(plan.patches).toEqual([]);
  });

  it('creates DRAFT products for new items, variants grouped under their product', () => {
    const plan = planCatalogSync({
      ...base,
      items: [
        item({ externalId: 'p1', name: 'Velvet', hasVariants: true, sku: 'VEL' }),
        item({
          externalId: 'va',
          type: 'variant',
          parentExternalId: 'p1',
          sku: 'VEL-1',
          label: '1 L',
        }),
        item({
          externalId: 'vb',
          type: 'variant',
          parentExternalId: 'p1',
          sku: 'VEL-2',
          label: '2.5 L',
          ikpu: 'bad',
        }),
        item({
          externalId: 'k1',
          type: 'bundle',
          sku: 'KIT',
          components: [{ externalId: 'va', qty: 2 }],
        }),
        item({ externalId: 'nosku', sku: null }),
      ],
      stock: new Map([['va', 5]]),
      local: [],
    });
    expect(
      plan.creates.map((c) => [c.externalId, c.type, c.name, c.variants.map((v) => v.sku)]),
    ).toEqual([
      ['p1', 'SIMPLE', 'Velvet', ['VEL-1', 'VEL-2']],
      ['k1', 'BUNDLE', 'Chalk White', ['KIT']],
    ]);
    expect(plan.creates[0]?.variants.map((v) => [v.label, v.stock, v.ikpu])).toEqual([
      ['1 L', 5, IKPU],
      ['2.5 L', 0, null],
    ]);
    expect(plan.creates[1]?.variants[0]?.stock).toBe(2);
    expect(plan.bundles).toEqual([
      { bundleExternalId: 'k1', components: [{ externalId: 'va', qty: 2 }] },
    ]);
    expect(plan.errors.some((e) => e.includes('IKPU'))).toBe(true);
    expect(plan.errors.some((e) => e.includes('artikul'))).toBe(true);
    expect(plan.checked).toBe(4);
  });

  it('attaches a new modification to the product already linked to its MoySklad product', () => {
    const plan = planCatalogSync({
      ...base,
      productsByExternalId: new Map([['p1', 'ourP']]),
      items: [item({ externalId: 'vc', type: 'variant', parentExternalId: 'p1', sku: 'VEL-5' })],
      stock: null,
      local: [],
      full: false,
    });
    expect(plan.creates[0]?.existingProductId).toBe('ourP');
  });

  it('IKPU: MoySklad value wins when valid, is never cleared, and guards re-activation', () => {
    const plan = planCatalogSync({
      ...base,
      items: [
        item({ externalId: 'ms1', sku: 'A', priceTiyin: 31_900_000n, ikpu: '11111111111111111' }),
        item({ externalId: 'ms2', sku: 'B', priceTiyin: 31_900_000n, ikpu: null }),
        item({ externalId: 'ms3', sku: 'C', priceTiyin: 31_900_000n, ikpu: null }),
      ],
      stock: null,
      local: [
        local({ id: 'v1', sku: 'A', moyskladId: 'ms1' }),
        local({ id: 'v2', sku: 'B', moyskladId: 'ms2' }),
        local({ id: 'v3', sku: 'C', moyskladId: 'ms3', ikpu: null, active: false }),
      ],
    });
    expect(plan.patches.map((p) => [p.variantId, p.ikpu, p.active])).toEqual([
      ['v1', '11111111111111111', undefined],
    ]);
    expect(plan.errors).toEqual(["C: IKPU yo'q — variant yoqilmadi"]);
  });

  it('follows a SKU change in MoySklad unless the new SKU is taken', () => {
    const plan = planCatalogSync({
      ...base,
      items: [
        item({ externalId: 'ms1', sku: 'A2', priceTiyin: 31_900_000n }),
        item({ externalId: 'ms2', sku: 'C', priceTiyin: 31_900_000n }),
      ],
      stock: null,
      local: [
        local({ id: 'v1', sku: 'A', moyskladId: 'ms1' }),
        local({ id: 'v2', sku: 'B', moyskladId: 'ms2' }),
        local({ id: 'v3', sku: 'C', moyskladId: 'ms3' }),
      ],
      full: false,
    });
    expect(plan.patches.map((p) => [p.variantId, p.newSku])).toEqual([['v1', 'A2']]);
    expect(plan.errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('planStockUpdates', () => {
  it('updates changed variants; kits from their composition', () => {
    const stock = new Map([
      ['a', 7],
      ['b', 1.5],
    ]);
    expect(
      planStockUpdates(
        [
          { id: 'v1', sku: 'A', moyskladId: 'a', stock: 7, bundle: null },
          { id: 'v2', sku: 'B', moyskladId: 'b', stock: 9, bundle: null },
          { id: 'v3', sku: 'X', moyskladId: 'x', stock: 2, bundle: null },
          { id: 'k', sku: 'KIT', moyskladId: 'k', stock: 0, bundle: [{ externalId: 'a', qty: 3 }] },
        ],
        stock,
      ),
    ).toEqual([
      { variantId: 'v2', sku: 'B', from: 9, to: 1 },
      { variantId: 'v3', sku: 'X', from: 2, to: 0 },
      { variantId: 'k', sku: 'KIT', from: 0, to: 2 },
    ]);
  });
});
