/**
 * Preset audience segments (docs/07 "Audiences", design Admin-Auditoriya). Inserted by the seed
 * and by migration `20261027153000_audiences` with identical rules (unit test). Product conditions
 * name the product as `slug:<seed slug>`; both resolve it to the product id when inserting and
 * skip the preset when the product does not exist. No destinations, no auto message: the owner
 * switches them on (CLAUDE.md §6 "Audiences").
 */
export interface AudiencePreset {
  key: string;
  name: string;
  description: string;
  rules: { groups: { conditions: Record<string, unknown>[] }[] };
}

export const PRODUCT_SLUG_PREFIX = 'slug:';

export const audiencePresets: AudiencePreset[] = [
  {
    key: 'abandoned_cart_7d',
    name: 'Savatni tashlaganlar · 7 kun',
    description: "Savatga qo'shgan, lekin xarid qilmagan",
    rules: {
      groups: [
        {
          conditions: [
            { type: 'event', event: 'add_to_cart', did: true, withinDays: 7 },
            { type: 'event', event: 'purchase', did: false, withinDays: 7 },
          ],
        },
      ],
    },
  },
  {
    key: 'sofa_kit_viewers',
    name: "Divanni ko'rib ketganlar",
    description: "Divan to'plami sahifasida 30 soniyadan ko'p bo'lgan, xarid qilmagan",
    rules: {
      groups: [
        {
          conditions: [
            {
              type: 'page_time',
              path: { op: 'equals', value: '/p/divan-yangilash-toplami' },
              minSeconds: 30,
              withinDays: 30,
              did: true,
            },
            { type: 'product', productId: 'slug:divan-yangilash-toplami', bought: false },
          ],
        },
      ],
    },
  },
  {
    key: 'leads_no_purchase',
    name: "Lead, xarid yo'q",
    description: 'Raqam qoldirgan (popup, tanlovchi, bot), xarid qilmagan',
    rules: {
      groups: [
        {
          conditions: [
            { type: 'lead', has: true },
            { type: 'orders', metric: 'count', op: 'lte', value: 0 },
          ],
        },
      ],
    },
  },
  {
    key: 'fabric_spray_upsell',
    name: 'Mato spreyi oldi → tozalovchi upsell',
    description: "Mato spreyi olgan, 21+ kun o'tgan, tozalovchi olmagan",
    rules: {
      groups: [
        {
          conditions: [
            {
              type: 'product',
              productId: 'slug:mato-boyogi-spreyi',
              bought: true,
              olderThanDays: 21,
            },
            { type: 'product', productId: 'slug:mato-tozalovchi', bought: false },
          ],
        },
      ],
    },
  },
  {
    key: 'vip',
    name: 'VIP mijozlar',
    description: "Xaridlari jami 2 mln so'mdan yuqori",
    rules: {
      groups: [{ conditions: [{ type: 'orders', metric: 'sum', op: 'gte', value: 2_000_000 }] }],
    },
  },
  {
    key: 'inactive_60d',
    name: 'Faol emas · 60+ kun',
    description: "Oxirgi xariddan 60 kun o'tgan",
    rules: { groups: [{ conditions: [{ type: 'last_order', op: 'older', days: 60 }] }] },
  },
];

/** Product slugs a preset's rules reference (`slug:<slug>` placeholders). */
export function presetProductSlugs(preset: AudiencePreset): string[] {
  const slugs: string[] = [];
  for (const g of preset.rules.groups)
    for (const c of g.conditions)
      if (typeof c.productId === 'string' && c.productId.startsWith(PRODUCT_SLUG_PREFIX))
        slugs.push(c.productId.slice(PRODUCT_SLUG_PREFIX.length));
  return slugs;
}
