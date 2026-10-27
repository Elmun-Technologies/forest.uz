import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IntegrationsService } from '../src/integrations/integrations.service';
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

  /** createTestApp writes process.env; drop keys the other suites don't reset themselves. */
  async function appWith(env: Record<string, string>): Promise<NestExpressApplication> {
    try {
      return await createTestApp(env);
    } finally {
      for (const k of ['DEV_ENDPOINTS_TOKEN', 'ALLOW_DEV_ADMIN_TOTP', 'ALLOW_FAKE_PROVIDERS'])
        delete process.env[k];
      process.env.NODE_ENV = 'test';
    }
  }

  it('with DEV_ENDPOINTS_TOKEN: everything needs X-Dev-Token except the narrow OTP lookup', async () => {
    const token = randomBytes(24).toString('hex');
    const gated = await appWith({ DEV_ENDPOINTS_TOKEN: token });
    try {
      const http = () => request(gated.getHttpServer());
      await http().get('/v1/dev/events').expect(404);
      await http().get('/v1/dev/events').set('X-Dev-Token', 'x'.repeat(48)).expect(404);
      await http().get('/v1/dev/events').set('X-Dev-Token', token).expect(200);
      await http().post('/v1/dev/telegram-login').send({ id: '1' }).expect(404);
      await http().delete('/v1/dev/outbox').expect(404);

      const outbox = gated.get(IntegrationsService).outbox;
      const phone = `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      outbox.push({ channel: 'sms', to: phone, text: 'Kod: 1111', templateKey: 'otp' }).at =
        new Date(Date.now() - 6 * 60_000);
      outbox.push({
        channel: 'sms',
        to: phone,
        text: 'Buyurtma F-1',
        templateKey: 'order_created',
      });
      outbox.push({ channel: 'sms', to: phone, text: 'Kod: 2222', templateKey: 'otp' });

      await http().get('/v1/dev/outbox').expect(404); // no listing without a phone
      const pub = await http()
        .get(`/v1/dev/outbox?to=${encodeURIComponent(phone)}`)
        .expect(200);
      expect(pub.body.map((m: { text: string }) => m.text)).toEqual(['Kod: 2222']);
      // An unencoded "+" (decoded as a space) still finds the phone.
      const raw = await http().get(`/v1/dev/outbox?to=${phone}`).expect(200);
      expect(raw.body).toHaveLength(1);
      const all = await http()
        .get(`/v1/dev/outbox?to=${encodeURIComponent(phone)}`)
        .set('X-Dev-Token', token)
        .expect(200);
      expect(all.body).toHaveLength(3);
    } finally {
      await gated.close();
    }
  });

  it('admin TOTP helper: 404 in production unless ALLOW_DEV_ADMIN_TOTP', async () => {
    const token = randomBytes(24).toString('hex');
    const prodEnv = {
      NODE_ENV: 'production',
      ALLOW_FAKE_PROVIDERS: 'true',
      DEV_ENDPOINTS_TOKEN: token,
    };
    for (const [allow, reachesHandler] of [
      ['false', false],
      ['true', true],
    ] as const) {
      const prod = await appWith({ ...prodEnv, ALLOW_DEV_ADMIN_TOTP: allow });
      try {
        const lookup = vi.spyOn(prod.get(PrismaService).staff, 'findUnique');
        await request(prod.getHttpServer())
          .post('/v1/dev/admin-totp')
          .set('X-Dev-Token', token)
          .send({ email: 'nobody@example.com' })
          .expect(404);
        expect(lookup.mock.calls.length > 0).toBe(reachesHandler);
      } finally {
        await prod.close();
      }
    }
  });
});
