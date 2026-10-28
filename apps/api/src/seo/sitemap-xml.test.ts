import { describe, expect, it } from 'vitest';
import { defaultRobots, normalizeRobots } from './robots';
import { buildSitemaps } from './sitemap-xml';
import {
  contextKey,
  isRevalidateTag,
  signWeb,
  verifyWeb,
  WEB_CONTEXTS,
  webSharedSecret,
} from './web-signature';

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
    // Empty files are still written (no rebuild per request), just not listed.
    expect(built.files.get('uz-categories.xml')).toMatch(/<urlset [^>]*>\n<\/urlset>/);
    expect(built.files.size).toBe(7);
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

describe('web signatures (shared secret, one key per purpose)', () => {
  const secret = webSharedSecret({
    NODE_ENV: 'production',
    WEB_REVALIDATE_SECRET: 's'.repeat(40),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  })!;
  const key = contextKey(secret, WEB_CONTEXTS.revalidate);
  it('verifies its own signatures within the clock skew only', () => {
    const body = '{"tags":["product:x"]}';
    const sig = signWeb(key, body, 1_000_000);
    expect(verifyWeb(key, sig, body, 1_000_100)).toBe(true);
    expect(verifyWeb(key, sig, body, 1_000_400)).toBe(false);
    expect(verifyWeb(key, sig, '{"tags":["settings"]}', 1_000_000)).toBe(false);
    expect(verifyWeb(contextKey(secret, WEB_CONTEXTS.notFound), sig, body, 1_000_000)).toBe(false);
    expect(verifyWeb(key, 'garbage', body, 1_000_000)).toBe(false);
    expect(verifyWeb(null, sig, body, 1_000_000)).toBe(false);
  });
  it('fails closed in production without the secret; dev/test derive one', () => {
    const appKey = Buffer.alloc(32, 7).toString('base64');
    expect(webSharedSecret({ NODE_ENV: 'production', APP_ENCRYPTION_KEY: appKey })).toBeNull();
    const dev = webSharedSecret({ NODE_ENV: 'development', APP_ENCRYPTION_KEY: appKey });
    expect(dev).toEqual(webSharedSecret({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: appKey }));
    expect(dev?.length).toBe(32);
  });
  it('accepts only storefront tag shapes', () => {
    expect(isRevalidateTag('product:chalk-white')).toBe(true);
    expect(isRevalidateTag('seo:/p/x')).toBe(true);
    expect(isRevalidateTag('settings')).toBe(true);
    expect(isRevalidateTag('Bad Tag')).toBe(false);
  });
});
