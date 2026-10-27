import { baseSearchText, buildSearchText, keywordsOf, skuStem } from './product-text';

describe('product text helpers', () => {
  it('skuStem: shared dash-separated prefix, else the first SKU', () => {
    expect(skuStem(['FR-CW-0500', 'FR-CW-1000', 'FR-CW-2500'])).toBe('FR-CW');
    expect(skuStem(['FR-WX-0250', 'FR-WX-0500'])).toBe('FR-WX');
    expect(skuStem(['FR-BR-40'])).toBe('FR-BR-40');
    expect(skuStem(['AB-1', 'CD-2'])).toBe('AB-1');
    expect(skuStem([])).toBe('');
  });

  it('keywords survive a rename (extra words of the stored search text)', () => {
    const before = {
      name: { uz: "Chalk White mebel bo'yog'i", ru: 'Краска Chalk White' },
      shortDesc: null,
      variants: [{ label: { uz: '1 L', ru: '1 л' }, sku: 'FR-CW-1000' }],
    };
    const stored = buildSearchText(baseSearchText(before), ['kraska', 'chalk paint']);
    const keywords = keywordsOf(stored, baseSearchText(before));
    expect(keywords).toEqual(['paint']);
    expect(
      keywordsOf(buildSearchText(baseSearchText(before), ['kraska dlya']), baseSearchText(before)),
    ).toEqual(['dlya']);
    const renamed = buildSearchText(
      baseSearchText({ ...before, name: { uz: 'Yangi', ru: 'Новая' } }),
      keywords,
    );
    expect(renamed).toContain('yangi');
    expect(renamed).toContain('paint');
    expect(renamed).not.toContain('chalk');
  });
});
