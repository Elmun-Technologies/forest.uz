import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

describe('catalog + settings API (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('health and readiness', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).get('/ready').expect(200);
  });

  it('lists seeded categories with counts', async () => {
    const res = await request(app.getHttpServer()).get('/v1/catalog/categories').expect(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual([
      'mebel-uchun',
      'mato-uchun',
      'aksessuarlar',
      'toplamlar',
    ]);
    expect(res.body.every((c: { productCount: number }) => c.productCount === 2)).toBe(true);
    expect(res.body[0].image.url).toBe(
      'http://cdn.test/forest-public/seed/photos/white-dresser.jpg',
    );
  });

  it('lists products with money in whole so’m and out-of-stock last', async () => {
    const res = await request(app.getHttpServer()).get('/v1/catalog/products').expect(200);
    expect(res.body.total).toBe(8);
    const last = res.body.items.at(-1);
    expect(last.slug).toBe('divan-yangilash-toplami');
    expect(last.inStock).toBe(false);
    expect(last.priceFromSoum).toBe(799000);
    expect(last.compareAtSoum).toBe(896000);
    expect(last.discountPct).toBe(11);
  });

  it('filters by colour, volume and price with disjunctive facets', async () => {
    const byColor = await request(app.getHttpServer())
      .get('/v1/catalog/products?color=5b6b3a')
      .expect(200);
    expect(byColor.body.items.map((p: { slug: string }) => p.slug)).toEqual(['mato-boyogi-spreyi']);
    expect(byColor.body.facets.colors).toHaveLength(4);
    const byVolume = await request(app.getHttpServer())
      .get('/v1/catalog/products?volume=1000')
      .expect(200);
    expect(byVolume.body.items.map((p: { slug: string }) => p.slug)).toEqual(['chalk-white']);
    const byPrice = await request(app.getHttpServer())
      .get('/v1/catalog/products?priceMax=120000&sort=price_asc')
      .expect(200);
    expect(byPrice.body.items.map((p: { priceFromSoum: number }) => p.priceFromSoum)).toEqual([
      79000, 119000,
    ]);
  });

  it('returns product detail in RU with variants and stock', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/catalog/products/chalk-white')
      .set('Accept-Language', 'ru')
      .expect(200);
    expect(res.body.name).toBe('Краска для мебели Chalk White');
    expect(
      res.body.variants.map((v: { label: string; available: number; lowStock: boolean }) => [
        v.label,
        v.available,
        v.lowStock,
      ]),
    ).toEqual(
      // Other suites reserve stock in the shared DB, so expectations come from the live rows.
      (
        await app.get(PrismaService).variant.findMany({
          where: { product: { slug: 'chalk-white' }, active: true },
          orderBy: { sort: 'asc' },
        })
      ).map((v) => {
        const available = Math.max(v.stock - v.reserved, 0);
        return [
          (v.label as { ru: string }).ru,
          available,
          available > 0 && available < v.lowStockAt,
        ];
      }),
    );
    expect(res.body.variants.map((v: { label: string }) => v.label)).toEqual([
      '0,5 л',
      '1 л',
      '2,5 л',
    ]);
    expect(res.body.rating).toBeNull();
    expect(res.body.coverageM2PerL).toBe(11);
    expect(res.body.related.length).toBeGreaterThan(0);
  });

  it('maps errors to stable codes and localized messages', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/catalog/products/nope?locale=ru')
      .expect(404);
    expect(res.body).toEqual({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Товар не найден.' } });
    const bad = await request(app.getHttpServer()).get('/v1/catalog/products?sort=x').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.field).toBe('sort');
  });

  it('exposes public settings without secrets', async () => {
    const res = await request(app.getHttpServer()).get('/v1/settings/public').expect(200);
    expect(res.body.delivery.zones[0]).toMatchObject({
      carrier: 'YANDEX',
      promiseHours: 12,
      cutoff: '18:00',
    });
    expect(res.body.store.legalComplete).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token/i);
  });

  it('dev outbox is available in fake mode', async () => {
    await request(app.getHttpServer()).get('/v1/dev/outbox').expect(200, []);
  });
});
