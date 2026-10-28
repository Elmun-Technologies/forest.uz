import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { productSeoTitle } from './admin-catalog-types';
import { redirectInputSchema, seoMetaInputSchema } from './schemas/seo';
import {
  cwvRating,
  parseVerificationCode,
  seoTemplate,
  serpCut,
  trimMetaDescription,
  withSiteName,
} from './seo';

const here = dirname(fileURLToPath(import.meta.url));
type Messages = Record<string, Record<string, string>>;
const messages = (l: 'uz' | 'ru') =>
  JSON.parse(
    readFileSync(resolve(here, `../../../apps/web/messages/${l}.json`), 'utf8'),
  ) as Messages;

/** Minimal ICU: `{name}` and `{count, plural, one {# x} few {# y} other {# z}}`. */
function icu(template: string, locale: string, vars: Record<string, string | number>): string {
  const plural = template.replace(
    /\{(\w+), plural, ((?:\w+ \{[^}]*\}\s*)+)\}/g,
    (_, key: string, body: string) => {
      const n = Number(vars[key]);
      const forms = Object.fromEntries(
        [...body.matchAll(/(\w+) \{([^}]*)\}/g)].map((m) => [m[1], m[2]]),
      );
      const form = forms[new Intl.PluralRules(locale).select(n)] ?? forms.other ?? '';
      return form.replace(/#/g, String(n));
    },
  );
  return plural.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

describe('seoTemplate (docs/10 defaults) matches the storefront messages', () => {
  for (const l of ['uz', 'ru'] as const) {
    const m = messages(l);
    it(`home / catalog / category / product / legal (${l})`, () => {
      expect(seoTemplate('home', l)).toEqual({
        title: m.meta!.title,
        description: m.meta!.description,
      });
      expect(seoTemplate('catalog', l)).toEqual({
        title: withSiteName(m.catalog!.metaTitle!),
        description: m.catalog!.metaDescription,
      });
      for (const count of [1, 3, 5, 21]) {
        const c = seoTemplate('category', l, { name: 'Mebel', count });
        expect(c.title).toBe(
          withSiteName(icu(m.catalog!.categoryMetaTitle!, l, { name: 'Mebel' })),
        );
        expect(c.description).toBe(
          trimMetaDescription(
            icu(m.catalog!.categoryMetaDescription!, l, { name: 'Mebel', count }),
          ),
        );
      }
      const p = seoTemplate('product', l, { name: 'Chalk White', text: 'Matli oq.' });
      expect(p.title).toBe(withSiteName(icu(m.product!.metaTitle!, l, { name: 'Chalk White' })));
      expect(p.title).toBe(productSeoTitle('Chalk White', l));
      expect(p.description).toBe(`Matli oq. ${m.product!.metaDescriptionTail}`);
      const legal = seoTemplate('legal', l, { name: 'Oferta', text: 'v1' });
      expect(legal.description).toBe(
        icu(m.legal!.metaDescription!, l, { title: 'Oferta', subtitle: 'v1' }),
      );
    });
  }

  it('category SEO text replaces the generated description', () => {
    expect(seoTemplate('category', 'uz', { name: 'X', count: 2, text: 'Maxsus matn' })).toEqual({
      title: withSiteName('X — narxlari, sotib olish'),
      description: 'Maxsus matn',
    });
  });
});

describe('helpers', () => {
  it('trims descriptions on a word boundary', () => {
    const long = `${'soz '.repeat(60)}oxiri`;
    const out = trimMetaDescription(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(serpCut('abcdef', 4)).toBe('abc…');
  });

  it('extracts verification codes from pasted meta tags', () => {
    expect(
      parseVerificationCode('<meta name="yandex-verification" content="a1b2c3d4e5f6" />'),
    ).toBe('a1b2c3d4e5f6');
    expect(parseVerificationCode('  AbC_123-xyz  ')).toBe('AbC_123-xyz');
    expect(parseVerificationCode('')).toBeNull();
    expect(parseVerificationCode('<script>alert(1)</script>')).toBe(false);
    expect(parseVerificationCode('"><b>')).toBe(false);
  });

  it('rates CWV values with web.dev thresholds', () => {
    expect(cwvRating('LCP', 2500)).toBe('good');
    expect(cwvRating('LCP', 3000)).toBe('needs-improvement');
    expect(cwvRating('INP', 501)).toBe('poor');
    expect(cwvRating('CLS', 0.1)).toBe('good');
    expect(cwvRating('CLS', 0.26)).toBe('poor');
  });

  it('validates inputs', () => {
    expect(
      seoMetaInputSchema.safeParse({
        path: '/p/x',
        locale: 'uz',
        title: 'a'.repeat(61),
        description: '',
      }).success,
    ).toBe(false);
    expect(
      seoMetaInputSchema.parse({
        path: '/p/x',
        locale: 'ru',
        title: 'T',
        description: 'D',
        canonical: '',
      }).canonical,
    ).toBeNull();
    expect(redirectInputSchema.safeParse({ from: '/a', to: '/b', code: 303 }).success).toBe(false);
    expect(redirectInputSchema.parse({ from: '/a', to: '/b' }).code).toBe(301);
  });
});
