import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, shopper } from './app';

/** Dev/e2e helpers: real behaviour behind them, and invisible outside fake mode. */
describe('dev endpoints (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('dev telegram login creates a phone-less customer with a session', async () => {
    const agent = shopper(app);
    const id = String(7_000_000_000 + Math.floor(Math.random() * 1_000_000));
    const me = await agent
      .post('/v1/dev/telegram-login')
      .send({ id, first_name: 'Aziza', username: 'aziza_dev' })
      .expect(200);
    expect(me.body.phone).toBeNull();
    expect(me.body.telegram).toEqual({ username: 'aziza_dev' });
    await agent.get('/v1/me').expect(200);
    await agent.post('/v1/dev/telegram-login').send({ id: 'abc' }).expect(400);
  });

  it('dev shipment drives the tracking courier block: full phone for the owner only', async () => {
    const owner = shopper(app);
    const v = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CW-1000' } });
    await owner.post('/v1/cart/items').send({ variantId: v.id, qty: 1 }).expect(201);
    const placed = await owner
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .send({
        name: 'Dilnoza',
        phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        region: 'tashkent_city',
        district: 'mirzo_ulugbek',
        addressLine: "Mirzo Ulug'bek, 5-uy",
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'COD',
        offerVersion: '2026-10-26-draft',
      });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: placed.body.publicId },
    });
    await request(app.getHttpServer())
      .post('/v1/dev/shipment')
      .send({
        publicId: order.publicId,
        status: 'COURIER_ASSIGNED',
        carrier: 'YANDEX',
        externalId: 'dev-claim-1',
        courier: { name: 'Bekzod Karimov', phone: '+998901234567', phoneExt: '123' },
      })
      .expect(200);

    const asOwner = await owner.get(`/v1/track/${order.trackingToken}`).expect(200);
    expect(asOwner.body.courier).toMatchObject({
      name: 'Bekzod',
      phone: '+998901234567',
      phoneExt: '123',
    });
    expect(asOwner.body.canChangeAddress).toBe(false);

    const stranger = await request(app.getHttpServer())
      .get(`/v1/track/${order.trackingToken}`)
      .expect(200);
    expect(stranger.body.courier.phone).not.toBe('+998901234567');
    expect(stranger.body.courier.phoneExt).toBeNull();

    await request(app.getHttpServer())
      .post('/v1/dev/shipment')
      .send({ publicId: 'nope', status: 'CREATED' })
      .expect(404);
  });

  it('is a 404 outside fake mode', async () => {
    const sandbox = await createTestApp({ PROVIDERS_MODE: 'sandbox' });
    try {
      await request(sandbox.getHttpServer())
        .post('/v1/dev/telegram-login')
        .send({ id: '1' })
        .expect(404);
      await request(sandbox.getHttpServer())
        .post('/v1/dev/shipment')
        .send({ publicId: 'x', status: 'CREATED' })
        .expect(404);
    } finally {
      await sandbox.close();
    }
  });
});
