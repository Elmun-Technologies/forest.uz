import { describe, expect, it } from 'vitest';
import { defaultRobots, normalizeRobots } from './robots';
import { buildSitemaps } from './sitemap-xml';
import {
  isRevalidateTag,
  revalidateKey,
  signRevalidate,
  verifyRevalidate,
} from './revalidate-signature';

describe('buildSitemaps', () => {
  const at = new Date('2026-10-20T10:00:00Z');
  const built = buildSitemaps('https://forest.uz/', {
    pages: [
      { path: '/', locales: ['uz', 'ru'], lastmod: null },
      { path: '/oferta', locales: ['uz'], lastmod: at },
    ],
    categories: [],
    products: [{ path: '/p/chalk-white', locales: ['uz', 'ru'], lastmod: at }],
  });

  it('writes an index of non-empty locale × type files', () => {
    expect(built.counts).toEqual([
      { name: 'uz-pages.xml', urls: 2 },
      { name: 'uz-products.xml', urls: 1 },
      { name: 'ru-pages.xml', urls: 1 },
      { name: 'ru-products.xml', urls: 1 },
    ]);
    expect(built.urls).toBe(5);
    const index = built.files.get('sitemap.xml')!;
    expect(index).toContain(
      '<loc>https://forest.uz/sitemaps/uz-products.xml</loc><lastmod>2026-10-20T10:00:00.000Z</lastmod>',
    );
    expect(index).not.toContain('categories');
  });

  it('lists hreflang alternates with x-default = uz', () => {
    const xml = built.files.get('ru-products.xml')!;
    expect(xml).toContain('<loc>https://forest.uz/ru/p/chalk-white</loc>');
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="uz" href="https://forest.uz/uz/p/chalk-white"/>',
    );
    expect(xml).toContain('hreflang="x-default" href="https://forest.uz/uz/p/chalk-white"');
    expect(built.files.get('uz-pages.xml')).toContain('<loc>https://forest.uz/uz</loc>');
    // A page published in one locale only has no ru alternate.
    expect(built.files.get('uz-pages.xml')).not.toContain('https://forest.uz/ru/oferta');
  });

  it('escapes XML', () => {
    const x = buildSitemaps('https://forest.uz', {
      pages: [{ path: '/a&b', locales: ['uz'], lastmod: null }],
      categories: [],
      products: [],
    });
    expect(x.files.get('uz-pages.xml')).toContain('/uz/a&amp;b');
  });
});

describe('robots', () => {
  it('generates the default with private paths and the sitemap', () => {
    const r = defaultRobots('https://forest.uz');
    expect(r).toContain('Disallow: /uz/checkout');
    expect(r).toContain('Disallow: /ru/kabinet');
    expect(r).toContain('Disallow: /t/');
    expect(r.trimEnd().endsWith('Sitemap: https://forest.uz/sitemap.xml')).toBe(true);
    expect(normalizeRobots('User-agent: *\r\nDisallow:\r\n\r\n')).toBe(
      'User-agent: *\nDisallow:\n',
    );
  });
});

describe('revalidate signature', () => {
  const key = revalidateKey(Buffer.alloc(32, 7).toString('base64'));
  it('verifies its own signatures within the clock skew only', () => {
    const body = '{"tags":["product:x"]}';
    const sig = signRevalidate(key, body, 1_000_000);
    expect(verifyRevalidate(key, sig, body, 1_000_100)).toBe(true);
    expect(verifyRevalidate(key, sig, body, 1_000_400)).toBe(false);
    expect(verifyRevalidate(key, sig, '{"tags":["settings"]}', 1_000_000)).toBe(false);
    expect(
      verifyRevalidate(revalidateKey(Buffer.alloc(32, 8).toString('base64')), sig, body, 1_000_000),
    ).toBe(false);
    expect(verifyRevalidate(key, 'garbage', body, 1_000_000)).toBe(false);
  });
  it('accepts only storefront tag shapes', () => {
    expect(isRevalidateTag('product:chalk-white')).toBe(true);
    expect(isRevalidateTag('seo:/p/x')).toBe(true);
    expect(isRevalidateTag('settings')).toBe(true);
    expect(isRevalidateTag('Bad Tag')).toBe(false);
  });
});
