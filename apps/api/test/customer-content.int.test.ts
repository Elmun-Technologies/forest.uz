import type { NestExpressApplication } from '@nestjs/platform-express';
import { containsPlaceholder } from '@forest/contracts';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp } from './app';

const UNRESOLVED_VAR = /\{[a-zA-Z0-9_.]+\}/;

/** Every string value in a JSON tree (keys excluded). */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function expectNoPlaceholders(body: unknown): void {
  for (const s of strings(body)) {
    expect(s).not.toMatch(UNRESOLVED_VAR);
    expect(containsPlaceholder(s)).toBe(false);
  }
}

describe('search, content, SEO feeds (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const slugs = (body: { products: { slug: string }[] }) => body.products.map((p) => p.slug);

  // ───────── Search ─────────

  it('finds paint by Latin transliteration and logs the query', async () => {
    const res = await http().get('/v1/catalog/search?q=kraska').expect(200);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect(slugs(res.body)).toContain('chalk-white');
    expect(res.body.query).toBe('kraska');
    const log = await prisma.searchQueryLog.findFirstOrThrow({
      where: { query: 'kraska' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.results).toBe(res.body.products.length);
  });

  it('ranks the fabric spray first for "краска для дивана" (RU, inflected)', async () => {
    const res = await http()
      .get('/v1/catalog/search')
      .query({ q: 'краска для дивана' })
      .set('Accept-Language', 'ru')
      .expect(200);
    expect(slugs(res.body)[0]).toBe('mato-boyogi-spreyi');
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toContain('mato-uchun');
    const log = await prisma.searchQueryLog.findFirstOrThrow({
      where: { query: 'краска для дивана' },
    });
    expect(log.locale).toBe('ru');
  });

  it("handles Uzbek apostrophes (bo'yoq / boʻyoq) and typos", async () => {
    for (const q of ["bo'yoq", 'boʻyoq', 'kraskaa']) {
      const res = await http().get('/v1/catalog/search').query({ q }).expect(200);
      expect(slugs(res.body)).toContain('chalk-white');
    }
  });

  it('logs zero-result queries and offers suggestions', async () => {
    const res = await http().get('/v1/catalog/search').query({ q: 'qwzxv' }).expect(200);
    expect(res.body.products).toEqual([]);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    const log = await prisma.searchQueryLog.findFirstOrThrow({ where: { query: 'qwzxv' } });
    expect(log.results).toBe(0);
  });

  it('never stores phone numbers typed into search; empty query returns nothing', async () => {
    await http().get('/v1/catalog/search').query({ q: '+998 90 123 45 67' }).expect(200);
    const logs = await prisma.searchQueryLog.findMany({ where: { query: { contains: '123' } } });
    expect(logs).toEqual([]);
    const empty = await http().get('/v1/catalog/search?q=').expect(200);
    expect(empty.body).toEqual({ query: '', products: [], categories: [], suggestions: [] });
  });

  // ───────── Content ─────────

  it('home: live-priced selector, FAQ with settings, no placeholders, no fake reviews', async () => {
    for (const lang of ['uz', 'ru']) {
      const res = await http().get('/v1/content/home').set('Accept-Language', lang).expect(200);
      expectNoPlaceholders(res.body);
      expect(res.body.faq.length).toBeGreaterThan(0);
      expect(res.body.faq.some((f: { a: string }) => f.a.includes('14'))).toBe(true);
      expect(res.body.bestsellers.length).toBeGreaterThan(0);
      expect(res.body.reviewsSummary).toBeNull();
      expect(res.body.gallery).toEqual([]);
    }

    const res = await http().get('/v1/content/home').expect(200);
    const kreslo = res.body.selector.find((s: { key: string }) => s.key === 'kreslo');
    const [cleaner, spray] = await Promise.all([
      prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CL-0500' } }),
      prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-FS-OLV' } }),
    ]);
    expect(kreslo.priceSoum).toBe(Number((cleaner.priceTiyin + 2n * spray.priceTiyin) / 100n));
    expect(kreslo.items).toEqual([
      { variantId: cleaner.id, productSlug: 'mato-tozalovchi', qty: 1 },
      { variantId: spray.id, productSlug: 'mato-boyogi-spreyi', qty: 2 },
    ]);
    expect(res.body.selector.find((s: { key: string }) => s.key === 'divan').inStock).toBe(true);

    // home.media from settings: hero slider with its product card, lead photo, no how-to video.
    expect(res.body.hero.before.url).toMatch(/hero-before\.jpg$/);
    expect(res.body.hero.after.url).toMatch(/hero-after\.jpg$/);
    expect(res.body.hero.product.slug).toBe('divan-yangilash-toplami');
    expect(res.body.leadImage.url).toMatch(/woman-green-sofa\.jpg$/);
    expect(res.body.howTo).toBeNull();
  });

  it('home: reviews summary is the real aggregate of approved reviews only', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'chalk-white' } });
    const customer = await prisma.customer.create({
      data: { phone: '+998977770001', name: 'Malika Karimova' },
    });
    const photo = await prisma.file.findFirstOrThrow({ where: { isPublic: true } });
    const review = (
      rating: number,
      status: 'APPROVED' | 'PENDING',
      orderId: string,
      photoConsent = false,
    ) =>
      prisma.review.create({
        data: {
          productId: product.id,
          customerId: customer.id,
          orderId,
          rating,
          text: 'Zo‘r chiqdi',
          locale: 'uz',
          source: 'web',
          status,
          photoFileIds: [photo.id],
          photoConsent,
        },
      });
    // Review.orderId has no FK in the schema; unique per (orderId, productId).
    const created = await Promise.all([
      review(5, 'APPROVED', 'o-1', true),
      review(4, 'APPROVED', 'o-2'),
      review(1, 'PENDING', 'o-3'),
    ]);
    try {
      const res = await http().get('/v1/content/home').expect(200);
      expect(res.body.reviewsSummary).toMatchObject({ average: 4.5, count: 2 });
      expect(res.body.reviewsSummary.distribution).toEqual([
        { stars: 5, pct: 50 },
        { stars: 4, pct: 50 },
        { stars: 3, pct: 0 },
        { stars: 2, pct: 0 },
        { stars: 1, pct: 0 },
      ]);
      expect(res.body.reviewsSummary.latest[0].author).toBe('Malika');

      const list = await http().get('/v1/catalog/products/chalk-white/reviews').expect(200);
      expect(list.body).toMatchObject({ page: 1, pageCount: 1, total: 2 });
      const byRating = new Map(
        list.body.items.map((r: { rating: number; photos: unknown[] }) => [r.rating, r]),
      );
      // Photos are published only with the customer's consent.
      expect((byRating.get(5) as { photos: unknown[] }).photos).toHaveLength(1);
      expect((byRating.get(4) as { photos: unknown[] }).photos).toEqual([]);
      expect(list.body.items[0].author).toBe('Malika');
      await http().get('/v1/catalog/products/no-such-product/reviews').expect(404);
    } finally {
      await prisma.review.deleteMany({ where: { id: { in: created.map((r) => r.id) } } });
      await prisma.customer.delete({ where: { id: customer.id } });
    }
  });

  it('legal page RU/UZ: draft while company data is missing, variables resolved', async () => {
    for (const locale of ['uz', 'ru'] as const) {
      const res = await http().get(`/v1/content/pages/legal/oferta?locale=${locale}`).expect(200);
      expect(res.body).toMatchObject({ kind: 'LEGAL', slug: 'oferta', draft: true });
      expect(res.body.version).toBeTruthy();
      expect(res.body.siblings.map((s: { slug: string }) => s.slug)).toEqual([
        'oferta',
        'maxfiylik',
        'qaytarish',
        'yetkazish-tolov',
      ]);
      expectNoPlaceholders(res.body);
      const text = strings(res.body.blocks).join('\n');
      expect(text).toContain('+998 99 820 22 77');
      expect(text).not.toMatch(/STIR|ИНН/); // rows needing the TIN are hidden until it exists
    }
    const ru = await http().get('/v1/content/pages/legal/oferta?locale=ru').expect(200);
    expect(ru.body.title).toBe('Публичная оферта');

    const delivery = await http().get('/v1/content/pages/LEGAL/yetkazish-tolov').expect(200);
    expect(strings(delivery.body.blocks).join(' ')).toMatch(/18:00.*12:00/);
    const returns = await http().get('/v1/content/pages/legal/qaytarish?locale=ru').expect(200);
    expectNoPlaceholders(returns.body);
    expect(strings(returns.body.blocks).join(' ')).toContain('14 дней');
    const privacy = await http().get('/v1/content/pages/legal/maxfiylik').expect(200);
    expect(strings(privacy.body.blocks).join(' ')).toContain('30 kun');

    await http().get('/v1/content/pages/legal/nope').expect(404);
    await http().get('/v1/content/pages/bogus/oferta').expect(404);
  });

  it('legal page leaves draft mode once the owner fills company data', async () => {
    const settings = app.get(SettingsService);
    const store = await settings.get('store.info');
    try {
      await settings.set('store.info', {
        ...store,
        legal: {
          entityName: 'Forest MChJ',
          stir: '301234567',
          address: 'Toshkent, Chilonzor 1',
          bank: 'Kapitalbank',
          mfo: '01088',
          account: '20208000900123456001',
        },
      });
      const res = await http().get('/v1/content/pages/legal/oferta').expect(200);
      expect(res.body.draft).toBe(false);
      const text = strings(res.body.blocks).join('\n');
      expect(text).toContain('Forest MChJ (STIR 301234567');
      expect(text).toContain('MFO 01088');
    } finally {
      await settings.set('store.info', store);
    }
  });

  // ───────── SEO ─────────

  it('serves sitemap data for active products, categories and published pages', async () => {
    const res = await http().get('/v1/seo/sitemap-data').expect(200);
    expect(res.body.products).toHaveLength(8);
    expect(res.body.products[0]).toEqual({
      slug: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toEqual([
      'mebel-uchun',
      'mato-uchun',
      'aksessuarlar',
      'toplamlar',
    ]);
    expect(res.body.pages).toContainEqual(
      expect.objectContaining({ kind: 'LEGAL', slug: 'oferta', locales: ['uz', 'ru'] }),
    );
    expect(res.body.pages.some((p: { kind: string }) => p.kind === 'FAQ')).toBe(false);
  });

  it('resolves redirects (query ignored, trailing-slash tolerant) and counts hits', async () => {
    const r = await prisma.redirect.create({
      data: { from: '/uz/p/eski-kraska', to: '/uz/p/chalk-white', code: 301 },
    });
    await http()
      .get('/v1/seo/redirect')
      .query({ path: '/uz/p/eski-kraska/?utm_source=x' })
      .expect(200, { to: '/uz/p/chalk-white', code: 301 });
    await http().get('/v1/seo/redirect').query({ path: '/uz/p/eski-kraska' }).expect(200);
    expect((await prisma.redirect.findUniqueOrThrow({ where: { id: r.id } })).hits).toBe(2);
    await http().get('/v1/seo/redirect').query({ path: '/uz/p/none' }).expect(404);
    await http().get('/v1/seo/redirect').query({ path: '//evil.com' }).expect(404);
  });

  it('logs 404s without query strings and with a sanitized referrer', async () => {
    for (let i = 0; i < 2; i++)
      await http()
        .post('/v1/seo/not-found')
        .send({
          path: '/ru/p/missing?token=secret#x',
          referrer: 'https://google.com/search?q=kraska',
        })
        .expect(204);
    const row = await prisma.notFoundLog.findUniqueOrThrow({ where: { path: '/ru/p/missing' } });
    expect(row.hits).toBe(2);
    expect(row.referrer).toBe('https://google.com/search');
    await http().post('/v1/seo/not-found').send({ path: 'no-slash' }).expect(400);
    const long = await http()
      .post('/v1/seo/not-found')
      .send({ path: `/${'a'.repeat(1500)}` })
      .expect(204);
    expect(long.status).toBe(204);
    expect(await prisma.notFoundLog.count({ where: { path: { startsWith: '/aaaa' } } })).toBe(1);
  });
});
