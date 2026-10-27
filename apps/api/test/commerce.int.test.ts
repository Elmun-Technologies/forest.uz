import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, nextTestIp, shopper } from './app';

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
    const agent = shopper(app);
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
    const agent = shopper(app);
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
    const second = shopper(app);
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
    const agent = shopper(app);
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
    const agents = [shopper(app), shopper(app)];
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
    const agent = shopper(app);
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
    const agent = shopper(app);
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
    const soldOut = await agent
      .post('/v1/cart/items')
      .send({ variantId: ids['FR-FS-GRY'], qty: 1 })
      .expect(409);
    expect(soldOut.body.error.code).toBe('OUT_OF_STOCK');
    const empty = await shopper(app)
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
    const agent = shopper(app);
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

describe('commerce: review fixes (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let lifecycle: OrderLifecycleService;
  let ids: Record<string, string>;
  let phoneSeq = 0;
  const phoneBase = 3_000_000 + Math.floor(Math.random() * 900_000);
  const nextPhone = () => `+99893${String(phoneBase + phoneSeq++).padStart(7, '0')}`;
  const key = () => `fix-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const body = (phone: string, overrides: Record<string, unknown> = {}) => ({
    name: 'Shahlo',
    phone,
    region: 'tashkent_city',
    addressLine: 'Chilonzor 9-kvartal, 3-uy',
    zoneKey: 'tashkent-city-yandex',
    paymentMethod: 'COD',
    offerVersion: 'v1',
    ...overrides,
  });
  async function cartWith(agent: Agent, sku = 'FR-BR-40', qty = 1) {
    return agent.post('/v1/cart/items').send({ variantId: ids[sku], qty }).expect(201);
  }
  const checkout = (agent: Agent, b: Record<string, unknown>, k = key()) =>
    agent.post('/v1/checkout/orders').set('Idempotency-Key', k).send(b);
  const orderOf = (publicId: string) =>
    prisma.order.findUniqueOrThrow({
      where: { publicId },
      include: { payments: { orderBy: { createdAt: 'asc' } }, reservations: true, events: true },
    });
  async function expire(orderId: string) {
    await prisma.reservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await lifecycle.expireStale();
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    lifecycle = app.get(OrderLifecycleService);
    const vs = await prisma.variant.findMany();
    ids = Object.fromEntries(vs.map((v) => [v.sku, v.id]));
  });
  afterAll(async () => {
    await app.close();
  });

  it('H1: a late checkout-link failure still returns the order (order page as next), idempotently', async () => {
    const agent = shopper(app);
    await cartWith(agent);
    const fake = await integrations.payment('payme');
    const spy = vi.spyOn(integrations, 'payment').mockResolvedValueOnce({
      key: 'payme',
      createCheckoutUrl: () => Promise.reject(new Error('provider down')),
    });
    const k = key();
    const b = body(nextPhone(), { paymentMethod: 'PAYME' });
    const res = await checkout(agent, b, k).expect(201);
    spy.mockRestore();
    expect(res.body.next).toEqual({
      type: 'redirect',
      url: `http://localhost:3000/uz/buyurtma/${res.body.publicId}`,
    });
    expect(String(res.headers['set-cookie'])).toContain('fr_ord=');
    expect((await checkout(agent, b, k).expect(201)).body).toEqual(res.body);
    const order = await orderOf(res.body.publicId);
    expect(order.status).toBe('NEW');
    expect(order.reservations.every((r) => r.releasedAt === null)).toBe(true);
    // "Pay again" works from the order page.
    const retry = await agent
      .post(`/v1/orders/${res.body.publicId}/pay`)
      .send({ method: 'PAYME' })
      .expect(201);
    expect(retry.body.url).toBe(
      await fake.createCheckoutUrl({
        orderId: order.publicId,
        orderNumber: order.number,
        amountTiyin: order.totalTiyin,
        returnUrl: `http://localhost:3000/uz/buyurtma/${order.publicId}`,
        locale: 'uz',
      }),
    );
  });

  it('H2: an expired unpaid SALOM10 order gives the code back to the phone and the device', async () => {
    const agent = shopper(app);
    const phone = nextPhone();
    await cartWith(agent);
    await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    const first = await checkout(agent, body(phone, { paymentMethod: 'CLICK' })).expect(201);
    const order = await orderOf(first.body.publicId);
    expect(order.promoCode).toBe('SALOM10');
    await expire(order.id);
    expect((await orderOf(first.body.publicId)).status).toBe('CANCELLED');

    await cartWith(agent);
    await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    const again = await checkout(agent, body(phone)).expect(201);
    const second = await prisma.order.findUniqueOrThrow({
      where: { publicId: again.body.publicId },
      include: { promoRedemption: true },
    });
    expect(second.promoCode).toBe('SALOM10');
    expect(second.promoRedemption).not.toBeNull();
    // History stays: both redemptions exist.
    expect(
      await prisma.promoRedemption.count({ where: { orderId: { in: [order.id, second.id] } } }),
    ).toBe(2);
  });

  it('M1: the API issues fr_aid; a second phone on the same device is refused a first-order code', async () => {
    const agent = shopper(app);
    const add = await cartWith(agent);
    const aid = (add.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('fr_aid='),
    );
    expect(aid).toMatch(/^fr_aid=[\w-]{20,};/);
    expect(aid).toMatch(/HttpOnly/i);
    expect(aid).toMatch(/SameSite=Lax/i);
    expect(aid).toMatch(/Max-Age=34560000/i);
    // Issued once: the next write keeps the same id.
    expect(String((await cartWith(agent, 'FR-RL-10')).headers['set-cookie'])).not.toContain(
      'fr_aid=',
    );
    await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    await checkout(agent, body(nextPhone())).expect(201);

    const cart = await cartWith(agent);
    const refused = await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(400);
    expect(refused.body.error.code).toBe('PROMO_ALREADY_USED');
    // Even with the code already on the cart (applied before the first order), checkout refuses.
    await prisma.cart.update({ where: { id: cart.body.id }, data: { promoCode: 'SALOM10' } });
    const atCheckout = await checkout(agent, body(nextPhone())).expect(400);
    expect(atCheckout.body.error).toMatchObject({ code: 'PROMO_ALREADY_USED', field: 'promoCode' });
  });

  it('H3: checkout is limited per IP (10/min) and per phone (5/h)', async () => {
    const server = app.getHttpServer();
    const ip = nextTestIp();
    for (let i = 0; i < 10; i++)
      await request(server)
        .post('/v1/checkout/orders')
        .set('X-Forwarded-For', ip)
        .set('Idempotency-Key', key())
        .send(body(nextPhone()))
        .expect(400); // empty cart, but the attempt counts
    const limited = await request(server)
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', ip)
      .set('Idempotency-Key', key())
      .send(body(nextPhone()))
      .expect(429);
    expect(limited.body.error.code).toBe('CHECKOUT_LIMITED');

    const phone = nextPhone();
    for (let i = 0; i < 5; i++)
      await request(server)
        .post('/v1/checkout/orders')
        .set('X-Forwarded-For', nextTestIp())
        .set('Idempotency-Key', key())
        .send(body(phone))
        .expect(400);
    const perPhone = await request(server)
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', nextTestIp())
      .set('Idempotency-Key', key())
      .send(body(phone))
      .expect(429);
    expect(perPhone.body.error.code).toBe('CHECKOUT_LIMITED');
  });

  it('H3: at most 2 open unconfirmed COD orders per phone; online payment stays possible', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 2; i++) {
      const a = shopper(app);
      await cartWith(a);
      await checkout(a, body(phone)).expect(201);
    }
    const a = shopper(app);
    await cartWith(a, 'FR-RL-10');
    const before = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } });
    const third = await checkout(a, body(phone)).expect(409);
    expect(third.body.error).toMatchObject({
      code: 'COD_OPEN_ORDERS_LIMIT',
      field: 'paymentMethod',
    });
    expect((await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).reserved).toBe(
      before.reserved,
    );
    await checkout(a, body(phone, { paymentMethod: 'PAYME' })).expect(201);
  });

  it('L2: two concurrent checkouts of one cart convert it once', async () => {
    const agent = shopper(app);
    await cartWith(agent, 'FR-RL-10', 2);
    const before = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } });
    const results = await Promise.all([
      checkout(agent, body(nextPhone())),
      checkout(agent, body(nextPhone(), { paymentMethod: 'PAYME' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)?.body.error.code).toBe('CART_EMPTY');
    const after = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } });
    expect(after.reserved).toBe(before.reserved + 2);
  });

  it('L4: a session never sees another customer’s cart left in the browser', async () => {
    const server = app.getHttpServer();
    const anon = shopper(app);
    const cart = await cartWith(anon);
    const other = await prisma.customer.create({ data: { phone: nextPhone() } });
    await prisma.cart.update({ where: { id: cart.body.id }, data: { customerId: other.id } });

    const phone = nextPhone();
    const ip = nextTestIp();
    await request(server)
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', ip)
      .send({ phone })
      .expect(200);
    const code = integrations.outbox
      .list(phone)
      .find((m) => m.templateKey === 'otp')
      ?.text.match(/\b(\d{4})\b/)?.[1];
    const login = await request(server)
      .post('/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ phone, code })
      .expect(200);
    const session = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('fr_session='))!
      .split(';')[0];
    const seen = await request(server)
      .get('/v1/cart')
      .set('Cookie', `${session}; fr_cart=${cart.body.id}`)
      .expect(200);
    expect(seen.body.id).not.toBe(cart.body.id);
    expect(seen.body.lines).toEqual([]);
  });

  it('L5: checkout consents go through the deduplicating consent log', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 2; i++) {
      const a = shopper(app);
      await cartWith(a);
      await checkout(
        a,
        body(phone, { paymentMethod: 'PAYME', consents: { smsMarketing: true, telegram: false } }),
      ).expect(201);
    }
    const customer = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    const rows = await prisma.consent.findMany({ where: { customerId: customer.id } });
    expect(rows).toEqual([
      expect.objectContaining({ channel: 'SMS_MARKETING', granted: true, source: 'checkout' }),
    ]);
  });

  it('L1: a PAID payment wins the displayed status; sibling open attempts expire', async () => {
    const agent = shopper(app);
    await cartWith(agent);
    const res = await checkout(agent, body(nextPhone(), { paymentMethod: 'PAYME' })).expect(201);
    const order = await orderOf(res.body.publicId);
    const payme = order.payments[0]!;
    // Payme bound a transaction to the first row, then the customer switched to Click.
    await prisma.payment.update({ where: { id: payme.id }, data: { providerTxnId: 'pm-l1-1' } });
    await agent.post(`/v1/orders/${order.publicId}/pay`).send({ method: 'CLICK' }).expect(201);
    // …and the Payme transaction is the one that got paid.
    await lifecycle.markPaid(payme.id, { type: 'PAYMENT_PROVIDER', id: 'payme' });
    const after = await orderOf(order.publicId);
    expect(after.payments.map((p) => [p.method, p.status])).toEqual([
      ['PAYME', 'PAID'],
      ['CLICK', 'EXPIRED'],
    ]);
    const view = await agent.get(`/v1/orders/${order.publicId}`).expect(200);
    expect(view.body).toMatchObject({ paymentStatus: 'PAID', canRetryPayment: false });
  });

  it('L3: operator confirm vs. the expiry job never leaves a confirmed order without stock', async () => {
    for (let i = 0; i < 4; i++) {
      const agent = shopper(app);
      await cartWith(agent);
      const res = await checkout(agent, body(nextPhone())).expect(201);
      const order = await orderOf(res.body.publicId);
      await prisma.reservation.updateMany({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const [confirm] = await Promise.allSettled([
        lifecycle.confirmCod(order.id, { type: 'STAFF', id: null }),
        lifecycle.expireStale(),
      ]);
      const after = await orderOf(order.publicId);
      if (after.status === 'CONFIRMED') {
        expect(after.reservations.every((r) => r.releasedAt === null)).toBe(true);
        expect(after.payments[0]?.status).toBe('COD_PENDING');
        expect(after.events.some((e) => e.to === 'CANCELLED')).toBe(false);
      } else {
        expect(after.status).toBe('CANCELLED');
        expect(confirm.status).toBe('rejected');
        expect(after.events.some((e) => e.to === 'CONFIRMED')).toBe(false);
      }
    }
  });

  it('L3/M4: COD confirmation sends order_confirmed; order SMS carry the tracking link', async () => {
    const agent = shopper(app);
    const phone = nextPhone();
    await cartWith(agent);
    const res = await checkout(agent, body(phone)).expect(201);
    const order = await orderOf(res.body.publicId);
    await lifecycle.confirmCod(order.id, { type: 'STAFF', id: null });
    const sms = integrations.outbox.list(phone);
    const link = `http://localhost:3000/t/${order.trackingToken}`;
    expect(sms.find((m) => m.templateKey === 'order_created')?.text).toContain(link);
    expect(sms.find((m) => m.templateKey === 'order_confirmed')?.text).toContain(link);
    expect(sms.some((m) => m.templateKey === 'order_paid')).toBe(false);
  });

  it('L7: one payment reminder after 15 min for unpaid online orders only', async () => {
    const online = shopper(app);
    const phone = nextPhone();
    await cartWith(online);
    const res = await checkout(online, body(phone, { paymentMethod: 'CLICK' })).expect(201);
    const cod = shopper(app);
    const codPhone = nextPhone();
    await cartWith(cod);
    await checkout(cod, body(codPhone)).expect(201);
    const paid = shopper(app);
    const paidPhone = nextPhone();
    await cartWith(paid);
    const p = await checkout(paid, body(paidPhone, { paymentMethod: 'PAYME' })).expect(201);
    await request(app.getHttpServer())
      .post('/v1/dev/fake-pay')
      .send({ order: p.body.publicId, result: 'success' })
      .expect(201);

    const reminders = (to: string) =>
      integrations.outbox.list(to).filter((m) => m.templateKey === 'payment_reminder');
    await lifecycle.remindUnpaid(new Date(Date.now() + 10 * 60_000));
    expect(reminders(phone)).toHaveLength(0); // too early

    const at = new Date(Date.now() + 16 * 60_000);
    await Promise.all([lifecycle.remindUnpaid(at), lifecycle.remindUnpaid(at)]);
    await lifecycle.remindUnpaid(new Date(Date.now() + 20 * 60_000));
    const sent = reminders(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(`http://localhost:3000/uz/buyurtma/${res.body.publicId}`);
    expect(sent[0]?.text).toMatch(/1[34] daqiqa/);
    expect(reminders(codPhone)).toHaveLength(0);
    expect(reminders(paidPhone)).toHaveLength(0);
    const order = await orderOf(res.body.publicId);
    expect(order.events.filter((e) => e.type === 'PAYMENT_REMINDER')).toHaveLength(1);
  });
});

describe('commerce: checkout without a connected payment provider (integration)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp({ PROVIDERS_MODE: 'sandbox' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('H1: refuses the method before writing anything (no order, stock, promo or key burnt)', async () => {
    const prisma = app.get(PrismaService);
    const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-BR-40' } });
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId: variant.id, qty: 1 }).expect(201);
    await agent.post('/v1/cart/promo').send({ code: 'SALOM10' }).expect(201);
    const phone = '+998935550101';
    const k = `nopay-${Date.now()}-abcdefgh`;
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', k)
      .send({
        name: 'Aziz',
        phone,
        region: 'tashkent_city',
        addressLine: 'Chilonzor 1-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'CLICK',
        offerVersion: 'v1',
      })
      .expect(400);
    expect(res.body.error).toMatchObject({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      field: 'paymentMethod',
    });
    expect(await prisma.order.count({ where: { contactPhone: phone } })).toBe(0);
    expect(await prisma.idempotencyKey.findUnique({ where: { key: k } })).toBeNull();
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).reserved).toBe(
      variant.reserved,
    );
    const cart = await agent.get('/v1/cart').expect(200);
    expect(cart.body.lines).toHaveLength(1);
    expect(cart.body.promo).toMatchObject({ code: 'SALOM10', status: 'applied' });
  });
});
