import { type LocalizedText, normalizeSearch } from '@forest/contracts';

/** Stored `{uz, ru}` JSON → both keys as strings (missing → ''). */
export function localized(value: unknown): LocalizedText {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    uz: typeof v.uz === 'string' ? v.uz : '',
    ru: typeof v.ru === 'string' ? v.ru : '',
  };
}

export function specsOf(value: unknown): { key: LocalizedText; value: LocalizedText }[] {
  if (!Array.isArray(value)) return [];
  return value.map((s: { key?: unknown; value?: unknown }) => ({
    key: localized(s?.key),
    value: localized(s?.value),
  }));
}

/** Text the storefront search must always find a product by (names, descriptions, variants). */
export function baseSearchText(p: {
  name: unknown;
  shortDesc: unknown;
  variants: { label: unknown; sku: string }[];
}): string {
  const name = localized(p.name);
  const short = localized(p.shortDesc);
  return normalizeSearch(
    [
      name.uz,
      name.ru,
      short.uz,
      short.ru,
      ...p.variants.flatMap((v) => {
        const l = localized(v.label);
        return [l.uz, l.ru, v.sku];
      }),
    ].join(' '),
  );
}

/**
 * Admin "qidiruv so'zlari": the stored searchText words the base text doesn't produce (seed
 * synonyms, words added in admin). Not a column — see CLAUDE.md §6.
 */
export function keywordsOf(searchText: string, base: string): string[] {
  const own = new Set(base.split(' '));
  return [...new Set(searchText.split(' '))].filter((w) => w && !own.has(w));
}

export function buildSearchText(base: string, keywords: readonly string[]): string {
  return normalizeSearch([base, ...keywords].join(' '));
}

/** Common SKU prefix of the variants ("FR-CW-0500", "FR-CW-1000" → "FR-CW"), else the first. */
export function skuStem(skus: readonly string[]): string {
  const [first, ...rest] = skus;
  if (!first) return '';
  if (rest.length === 0) return first;
  let common = first.split('-');
  for (const s of rest) {
    const parts = s.split('-');
    let i = 0;
    while (i < common.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.length >= 2 ? common.join('-') : first;
}
