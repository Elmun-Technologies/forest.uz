import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, shopper } from './app';

describe('GET /cart with a map pin (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('accepts lat/lng for the chosen zone; live quote off → zone price; validates ranges', async () => {
    const agent = shopper(app);
    const v = await app
      .get(PrismaService)
      .variant.findUniqueOrThrow({ where: { sku: 'FR-CW-0500' } });
    await agent.post('/v1/cart/items').send({ variantId: v.id, qty: 1 }).expect(201);
    const plain = await agent.get('/v1/cart?zone=tashkent-city-yandex').expect(200);
    const pinned = await agent
      .get('/v1/cart?zone=tashkent-city-yandex&lat=41.3111&lng=69.2797')
      .expect(200);
    expect(pinned.body.totals.shippingSoum).toBe(plain.body.totals.shippingSoum);
    await agent.get('/v1/cart?zone=tashkent-city-yandex&lat=200&lng=69').expect(400);
  });
});
