import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

type Agent = ReturnType<typeof request.agent>;

describe('commerce: cart → checkout → payment → tracking (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let ids: Record<string, string>;

  const variant = async (sku: string) => await prisma.variant.findUniqueOrThrow({ where: { sku } });
  const key = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const checkoutBody = (phone: string, overrides: Record<string, unknown> = {}) => ({
    name: 'Dilnoza',
    phone,
    region: 'tashkent_city',
    district: 'mirzo_ulugbek',
    addressLine: "Mirzo Ulug'bek, 5-uy, 12-xonadon",
    zoneKey: 'tashkent-city-yandex',
    paymentMethod: 'COD',
    offerVersion: '2026-10-26-draft',
    ...overrides,
  });
  async function fillCart(agent: Agent, items: [string, number][]) {
    for (const [sku, qty] of items) {
      await agent.post('/v1/cart/items').send({ variantId: ids[sku], qty }).expect(201);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const vs = await prisma.variant.findMany();
    ids = Object.fromEntries(vs.map((v) => [v.sku, v.id]));
  });
  afterAll(async () => {
    await app.close();
  });

  it('builds a cart with cookie, promo and delivery quote', async () => {
    const agent = request.agent(app.getHttpServer());
    const empty = await agent.get('/v1/cart').expect(200);
    expect(empty.body.lines).toEqual([]);

    const add = await agent
      .post('/v1/cart/items')
      .send({ variantId: ids['FR-CW-1000'], qty: 1 })
      .expect(201);
    expect(String(add.headers['set-cookie'])).toMatch(/fr_cart=.*HttpOnly/i);
    await fillCart(agent, [['FR-FS-OLV', 1]]);
    const cart = await agent.get('/v1/cart').expect(200);
    expect(cart.body.totals).toMatchObject({
      itemsCount: 2,
      subtotalSoum: 578000,
      discountSoum: 0,
      shippingSoum: 0,
      totalSoum: 578000,
    });
    expect(cart.body.upsell).toMatchObject({ productSlug: expect.any(String) });

    const bad = await agent.post('/v1/cart/promo').send({ code: 'NOPE99' }).expect(400);
    expect(bad.body.error.code).toBe('PROMO_NOT_FOUND');
    const promo = await agent.post('/v1/cart/promo').send({ code: 'salom10' }).expect(201);
    expect(promo.body.promo).toEqual({ code: 'SALOM10', status: 'applied', discountSoum: 57800 });
    expect(promo.body.totals.totalSoum).toBe(520200);

    const quote = await agent.get('/v1/cart/quote?region=tashkent_city').expect(200);
    expect(quote.body.map((o: { zoneKey: string }) => o.zoneKey)).toEqual([
      'tashkent-city-yandex',
      'tashkent-city-bts',
    ]);
    expect(quote.body[0]).toMatchObject({ carrier: 'YANDEX', priceSoum: 0 });
    const regions = await agent.get('/v1/cart/quote?region=samarkand').expect(200);
    expect(regions.body).toMatchObject([{ zoneKey: 'regions-bts', priceSoum: 45000 }]);

    const qty = await agent
      .patch(`/v1/cart/items/${ids['FR-FS-OLV']}`)
      .send({ qty: 0 })
      .expect(200);
    expect(qty.body.lines).toHaveLength(1);
  });

  it('places a COD order: reserves stock, redeems promo, converts cart, notifies, idempotent', async () => {
    const agent = request.agent(app.getHttpServer());
    await fillCart(agent, [
      ['FR-CW-1000', 1],
      ['FR-FS-OLV', 1],
    ]);
    await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    const before = await variant('FR-CW-1000');

    await agent.post('/v1/checkout/orders').send(checkoutBody('+998901110001')).expect(400);
    const k = key();
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', k)
      .send(checkoutBody('90 111 00 01'))
      .expect(201);
    expect(res.body.orderNumber).toMatch(/^F-\d{5,}$/);
    expect(res.body.next).toEqual({ type: 'cod' });
    const again = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', k)
      .send(checkoutBody('90 111 00 01'))
      .expect(201);
    expect(again.body).toEqual(res.body);
    await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', k)
      .send(checkoutBody('90 111 00 02'))
      .expect(409);

    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: res.body.publicId },
      include: { items: true, reservations: true, payments: true, promoRedemption: true },
    });
    expect(order.totalTiyin).toBe(52020000n);
    expect(order.items.reduce((a, i) => a + i.discountTiyin, 0n)).toBe(order.discountTiyin);
    expect(order.items.every((i) => i.ikpu.length > 0)).toBe(true);
    expect(order.payments[0]?.status).toBe('COD_PENDING');
    expect(order.promoRedemption?.discountTiyin).toBe(5780000n);
    expect((await variant('FR-CW-1000')).reserved).toBe(before.reserved + 1);
    expect((await agent.get('/v1/cart').expect(200)).body.lines).toEqual([]);

    const sms = app.get(IntegrationsService).outbox.list('+998901110001');
    expect(
      sms.some((m) => m.templateKey === 'order_created' && m.text.includes(order.number)),
    ).toBe(true);

    // The browser that placed the order sees full contact; a forwarded link sees it masked.
    const own = await agent.get(`/v1/orders/${order.publicId}`).expect(200);
    expect(own.body.contactPhone).toBe('+998 90 111 00 01');
    expect(own.body.address.line).toContain("Mirzo Ulug'bek");
    const other = await request(app.getHttpServer())
      .get(`/v1/orders/${order.publicId}`)
      .expect(200);
    expect(other.body.contactPhone).toBe('+998 90 *** ** 01');
    expect(other.body.address.line).toBe('');
    expect(other.body.timeline.map((s: { state: string }) => s.state)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);

    const track = await request(app.getHttpServer())
      .get(`/v1/track/${order.trackingToken}`)
      .expect(200);
    expect(track.body).toMatchObject({ number: order.number, canChangeAddress: true });
    await request(app.getHttpServer())
      .patch(`/v1/track/${order.trackingToken}/address`)
      .send({ addressLine: 'Boshqa manzil 1' })
      .expect(401);

    // First-order code can't be reused by the same phone.
    const second = request.agent(app.getHttpServer());
    await fillCart(second, [['FR-BR-40', 1]]);
    await second.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    const reuse = await second
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110001'))
      .expect(400);
    expect(reuse.body.error).toMatchObject({ code: 'PROMO_FIRST_ORDER_ONLY', field: 'promoCode' });
  });

  it('online payment: fake checkout redirect, webhook-like confirmation, idempotent, SLA set', async () => {
    const agent = request.agent(app.getHttpServer());
    await fillCart(agent, [['FR-CL-0500', 1]]);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110003', { paymentMethod: 'PAYME' }))
      .expect(201);
    expect(res.body.next.type).toBe('redirect');
    expect(res.body.next.url).toMatch(/\/uz\/fake-pay\?provider=payme&order=/);

    const fail = await request(app.getHttpServer())
      .post('/v1/dev/fake-pay')
      .send({ order: res.body.publicId, result: 'fail' })
      .expect(201);
    expect(fail.body.ok).toBe(true);
    const failed = await request(app.getHttpServer())
      .get(`/v1/orders/${res.body.publicId}`)
      .expect(200);
    expect(failed.body).toMatchObject({ paymentStatus: 'FAILED', canRetryPayment: true });
    const retry = await request(app.getHttpServer())
      .post(`/v1/orders/${res.body.publicId}/pay`)
      .send({ method: 'CLICK' })
      .expect(201);
    expect(retry.body.url).toContain('provider=click');

    await request(app.getHttpServer())
      .post('/v1/dev/fake-pay')
      .send({ order: res.body.publicId, result: 'success' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/dev/fake-pay')
      .send({ order: res.body.publicId, result: 'success' })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: res.body.publicId },
      include: { payments: true, reservations: true, events: true },
    });
    expect(order.status).toBe('CONFIRMED');
    expect(order.payments.filter((p) => p.status === 'PAID')).toHaveLength(1);
    expect(order.slaDueAt).not.toBeNull();
    expect(order.reservations.every((r) => r.expiresAt === null)).toBe(true);
    expect(order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
  });

  it('never oversells under concurrent checkouts', async () => {
    const wax = await variant('FR-WX-0250');
    const available = wax.stock - wax.reserved;
    const want = Math.floor(available / 2) + 1; // two orders of this size can't both fit
    const agents = [request.agent(app.getHttpServer()), request.agent(app.getHttpServer())];
    for (const a of agents) await fillCart(a, [['FR-WX-0250', want]]);
    const results = await Promise.all(
      agents.map((a, i) =>
        a
          .post('/v1/checkout/orders')
          .set('Idempotency-Key', key())
          .send(checkoutBody(`+99890111002${i}`)),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('INSUFFICIENT_STOCK');
    const after = await variant('FR-WX-0250');
    expect(after.reserved).toBe(wax.reserved + want);
    expect(after.stock - after.reserved).toBeGreaterThanOrEqual(0);
  });

  it('expires unpaid online orders: payment EXPIRED, stock released, order CANCELLED', async () => {
    const agent = request.agent(app.getHttpServer());
    await fillCart(agent, [['FR-RL-10', 2]]);
    const before = await variant('FR-RL-10');
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110005', { paymentMethod: 'CLICK' }))
      .expect(201);
    expect((await variant('FR-RL-10')).reserved).toBe(before.reserved + 2);
    const order = await prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
    await prisma.reservation.updateMany({
      where: { orderId: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await app.get(OrderLifecycleService).expireStale()).toBeGreaterThanOrEqual(1);
    const expired = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(expired.status).toBe('CANCELLED');
    expect(expired.payments[0]?.status).toBe('EXPIRED');
    expect((await variant('FR-RL-10')).reserved).toBe(before.reserved);
    // Running again is a no-op.
    await app.get(OrderLifecycleService).expireStale();
    expect((await variant('FR-RL-10')).reserved).toBe(before.reserved);
  });

  it('enforces COD limit, delivery zone and stock checks', async () => {
    const agent = request.agent(app.getHttpServer());
    await fillCart(agent, [['FR-CW-2500', 5]]);
    const limit = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110006'))
      .expect(400);
    expect(limit.body.error.code).toBe('COD_LIMIT_EXCEEDED');
    const zone = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110006', { region: 'samarkand' }))
      .expect(400);
    expect(zone.body.error.code).toBe('DELIVERY_UNAVAILABLE');
    const kit = await agent
      .post('/v1/cart/items')
      .send({ variantId: ids['FR-KIT-S'], qty: 1 })
      .expect(409);
    expect(kit.body.error.code).toBe('OUT_OF_STOCK');
    const empty = await request
      .agent(app.getHttpServer())
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', key())
      .send(checkoutBody('+998901110007'))
      .expect(400);
    expect(empty.body.error.code).toBe('CART_EMPTY');
  });
});

describe('commerce concurrency (integration)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('processes concurrent duplicate payment callbacks exactly once', async () => {
    const prisma = app.get(PrismaService);
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-BR-40' } })).id;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `dup-${Date.now()}-abcdefgh`)
      .send({
        name: 'Aziz',
        phone: '+998901110099',
        region: 'tashkent_city',
        addressLine: 'Chilonzor 1-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'PAYME',
        offerVersion: 'v1',
      })
      .expect(201);
    const hits = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/v1/dev/fake-pay')
          .send({ order: res.body.publicId, result: 'success' }),
      ),
    );
    expect(hits.every((h) => h.status === 201)).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: res.body.publicId },
      include: { events: true },
    });
    expect(order.status).toBe('CONFIRMED');
    expect(order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
    expect(order.events.filter((e) => e.to === 'CONFIRMED')).toHaveLength(1);
  });
});
