import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { DomainError } from '@forest/contracts';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { OrdersService } from '../src/commerce/orders.service';
import { DELIVERY_QUEUE, SYNC_JOB } from '../src/delivery/delivery.module';
import { YandexShipmentService } from '../src/delivery/yandex-shipment.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { yandexCallbackKey } from '../src/integrations/providers/yandex-delivery';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp, shopper } from './app';
import { YandexStub } from './yandex-stub';

/**
 * Yandex Delivery against a local stub of b2b.taxi.yandex.net: live quote, claim create
 * (idempotent), explicit accept, status sync driving order transitions + SMS exactly once,
 * cancel, API failures, polling concurrency and courier-phone privacy on the tracking page.
 */
describe('delivery: Yandex claims + shipment lifecycle (integration)', () => {
  const stub = new YandexStub();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let lifecycle: OrderLifecycleService;
  let yandex: YandexShipmentService;
  let settings: SettingsService;
  let ownerId: string;
  let phoneSeq = 0;
  const staff = () => ({ type: 'STAFF' as const, id: ownerId });
  const appSecret = () => process.env.APP_ENCRYPTION_KEY ?? '';

  const credentials = (over: Record<string, string> = {}) => ({
    oauthToken: stub.token,
    sourceAddress: 'Toshkent, Chilonzor 9-kvartal, 5-uy',
    sourceLat: '41.2850',
    sourceLng: '69.2040',
    sourceContactName: 'Forest ombor',
    sourceContactPhone: '+998901234567',
    allowCod: 'on',
    callbacks: 'on',
    mode: 'live',
    ...over,
  });

  async function placeCod(opts: { lat?: number; lng?: number } = {}) {
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `yd-${Date.now()}-${++phoneSeq}-abcdefgh`)
      .send({
        name: 'Malika Karimova',
        phone: `+9989033${String(phoneSeq).padStart(5, '0')}`,
        region: 'tashkent_city',
        district: 'yunusobod',
        addressLine: 'Yunusobod 4-kvartal, 12-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'COD',
        offerVersion: 'v1',
        ...opts,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
    return { order, agent };
  }

  async function confirmedOrder() {
    const placed = await placeCod();
    await lifecycle.confirmCod(placed.order.id, staff());
    return placed;
  }

  const shipmentOf = (orderId: string) =>
    prisma.shipment.findFirstOrThrow({ where: { orderId, carrier: 'YANDEX' } });
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const smsCount = (customerId: string, templateKey: string) =>
    prisma.message.count({ where: { customerId, templateKey } });
  const statusEvents = (orderId: string) =>
    prisma.orderEvent.findMany({
      where: { orderId, type: 'STATUS_CHANGED' },
      orderBy: { createdAt: 'asc' },
    });
  const later = (min: number) => new Date(Date.now() + min * 60_000);

  /** Created + accepted claim for a confirmed COD order. */
  async function acceptedClaim() {
    const placed = await confirmedOrder();
    const created = await yandex.createClaim(placed.order.id, staff());
    await yandex.acceptClaim(created.shipmentId, staff());
    return { ...placed, shipmentId: created.shipmentId, claimId: created.claimId! };
  }

  const courier = {
    courier_name: 'Aziz Karimov',
    car_model: 'Damas',
    car_color: 'oq',
    car_number: '01 A 123 BC',
  };

  beforeAll(async () => {
    await stub.start();
    app = await createTestApp({ PROVIDERS_MODE: 'sandbox', YANDEX_DELIVERY_API_URL: stub.url });
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    lifecycle = app.get(OrderLifecycleService);
    yandex = app.get(YandexShipmentService);
    settings = app.get(SettingsService);
    // The tests drive the minute job themselves (fixed clocks, fault injection).
    await app.get<Queue>(getQueueToken(DELIVERY_QUEUE)).removeJobScheduler(SYNC_JOB);
    ownerId = (
      await prisma.staff.create({
        data: { email: `yd-owner-${Date.now()}@t.uz`, name: 'O', role: 'OWNER', passwordHash: 'x' },
      })
    ).id;
    const health = await integrations.connect('yandex_delivery', credentials(), ownerId, null);
    expect(health.ok).toBe(true);
  });

  afterAll(async () => {
    await prisma.integration.updateMany({
      where: { key: 'yandex_delivery' },
      data: { status: 'DISCONNECTED', credentials: null },
    });
    await app.close();
    await stub.stop();
  });

  it('health check is an authenticated claims/search on the API host', async () => {
    const search = stub.calls.find((c) => c.path === 'claims/search');
    expect(search?.auth).toBe(`Bearer ${stub.token}`);
    const bad = await integrations.test('yandex_delivery', credentials({ oauthToken: 'wrong' }));
    expect(bad).toEqual({ ok: false, message: 'token rejected by Yandex (401/403)' });
  });

  it('live quote: cart quote and checkout charge the same cached Yandex price; no pin → zone price', async () => {
    const zones = await settings.get('delivery.zones');
    await settings.set(
      'delivery.zones',
      zones.map((z) => (z.key === 'tashkent-city-yandex' ? { ...z, liveQuote: true } : z)),
    );
    try {
      const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
      const agent = shopper(app);
      await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
      const before = stub.count('check-price');
      const pin = { lat: 41.3611, lng: 69.2891 };
      const yandexOption = (body: { zoneKey: string; priceSoum: number }[]) =>
        body.find((o) => o.zoneKey === 'tashkent-city-yandex')?.priceSoum;
      const quote = await agent
        .get(`/v1/cart/quote?region=tashkent_city&lat=${pin.lat}&lng=${pin.lng}`)
        .expect(200);
      expect(yandexOption(quote.body)).toBe(27_500);
      const noPin = await agent.get('/v1/cart/quote?region=tashkent_city').expect(200);
      expect(yandexOption(noPin.body)).toBe(30_000);

      stub.price = '99999.00'; // a newer Yandex price must not change what the customer was shown
      const res = await agent
        .post('/v1/checkout/orders')
        .set('Idempotency-Key', `yd-quote-${Date.now()}-abcdefgh`)
        .send({
          name: 'Malika Karimova',
          phone: `+9989033${String(++phoneSeq).padStart(5, '0')}`,
          region: 'tashkent_city',
          addressLine: 'Yunusobod 4-kvartal, 12-uy',
          zoneKey: 'tashkent-city-yandex',
          paymentMethod: 'COD',
          offerVersion: 'v1',
          ...pin,
        })
        .expect(201);
      const order = await prisma.order.findUniqueOrThrow({
        where: { publicId: res.body.publicId },
      });
      expect(order.shippingTiyin).toBe(2_750_000n);
      expect(stub.count('check-price')).toBe(before + 1);
      const sent = stub.calls.filter((c) => c.path === 'check-price').at(-1)?.body as {
        route_points: { coordinates: number[] }[];
      };
      expect(sent.route_points.map((p) => p.coordinates)).toEqual([
        [69.204, 41.285],
        [pin.lng, pin.lat],
      ]);
      const { order: zonePriced } = await placeCod();
      expect(zonePriced.shippingTiyin).toBe(3_000_000n);
    } finally {
      stub.price = '27500.00';
      await settings.set('delivery.zones', zones);
    }
  });

  it('create claim: idempotent on a lost response, on repeats and under concurrency; accept is explicit', async () => {
    const { order } = await confirmedOrder();
    const creates = stub.count('claims/create');
    // The first create reaches Yandex but the response is lost: the retry reuses request_id.
    stub.fail('claims/create', 'reset-after');
    const created = await yandex.createClaim(order.id, staff());
    expect(stub.count('claims/create')).toBe(creates + 2);
    const ids = stub.calls
      .filter((c) => c.path === 'claims/create')
      .slice(-2)
      .map((c) => c.query.get('request_id'));
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(`${created.shipmentId}-1`);
    const claimsForOrder = [...stub.claims.values()].filter((c) =>
      c.requestId.startsWith(created.shipmentId),
    );
    expect(claimsForOrder).toHaveLength(1);

    const again = await Promise.all([1, 2, 3].map(() => yandex.createClaim(order.id, staff())));
    expect(new Set(again.map((a) => a.claimId))).toEqual(new Set([created.claimId]));
    expect(stub.count('claims/create')).toBe(creates + 2);

    const s = await shipmentOf(order.id);
    expect(s).toMatchObject({ status: 'CREATED', externalId: created.claimId, acceptedAt: null });
    // Not dispatched yet: estimation only.
    expect(stub.claims.get(created.claimId!)?.status).toBe('ready_for_approval');
    const body = stub.claims.get(created.claimId!)!.body as {
      route_points: { type: string; contact: { phone: string }; external_order_id?: string }[];
      callback_properties?: { callback_url: string };
      auto_accept?: boolean;
    };
    expect(body.auto_accept).toBeUndefined();
    expect(body.route_points[1]).toMatchObject({
      type: 'destination',
      external_order_id: order.number,
    });
    expect(body.callback_properties?.callback_url).toContain(
      `key=${yandexCallbackKey(appSecret())}&`,
    );

    const accepts = stub.count('claims/accept');
    await Promise.all([yandex.acceptClaim(s.id, staff()), yandex.acceptClaim(s.id, staff())]);
    expect(stub.count('claims/accept')).toBe(accepts + 1);
    expect(stub.claims.get(created.claimId!)?.status).toBe('accepted');
    expect((await shipmentOf(order.id)).acceptedAt).not.toBeNull();
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id, type: { startsWith: 'DELIVERY_' } },
    });
    expect(events.filter((e) => e.type === 'DELIVERY_CLAIM_CREATED')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'DELIVERY_ACCEPTED')).toHaveLength(1);
  });

  it('test mode: claims are created, accept is refused without calling Yandex', async () => {
    await integrations.connect('yandex_delivery', credentials({ mode: 'test' }), ownerId, null);
    try {
      const { order } = await confirmedOrder();
      const created = await yandex.createClaim(order.id, staff());
      const accepts = stub.count('claims/accept');
      await expect(yandex.acceptClaim(created.shipmentId, staff())).rejects.toMatchObject({
        code: 'DELIVERY_TEST_MODE',
      });
      expect(stub.count('claims/accept')).toBe(accepts);
    } finally {
      await integrations.connect('yandex_delivery', credentials(), ownerId, null);
    }
  });

  it('accept: a lost response is resolved from claims/info; an expired offer is reported', async () => {
    const { order } = await confirmedOrder();
    const created = await yandex.createClaim(order.id, staff());
    stub.fail('claims/accept', 'reset-after');
    await yandex.acceptClaim(created.shipmentId, staff());
    expect(stub.claims.get(created.claimId!)?.status).toBe('accepted');
    expect((await shipmentOf(order.id)).acceptedAt).not.toBeNull();

    const other = await confirmedOrder();
    const second = await yandex.createClaim(other.order.id, staff());
    stub.fail('claims/accept', { status: 409, body: { code: 'offer_expired', message: 'x' } });
    await expect(yandex.acceptClaim(second.shipmentId, staff())).rejects.toMatchObject({
      code: 'DELIVERY_CLAIM_NOT_READY',
      details: { code: 'offer_expired' },
    });
    expect((await shipmentOf(other.order.id)).acceptedAt).toBeNull();
  });

  it('refuses claims for unconfirmed orders and COD orders unless allowed', async () => {
    const { order } = await placeCod();
    await expect(yandex.createClaim(order.id, staff())).rejects.toMatchObject({
      code: 'SHIPMENT_ORDER_NOT_READY',
    });
    await lifecycle.confirmCod(order.id, staff());
    await integrations.connect('yandex_delivery', credentials({ allowCod: 'off' }), ownerId, null);
    try {
      await expect(yandex.createClaim(order.id, staff())).rejects.toMatchObject({
        code: 'DELIVERY_COD_UNSUPPORTED',
      });
    } finally {
      await integrations.connect('yandex_delivery', credentials(), ownerId, null);
    }
  });

  it('courier assigned → picked up → delivered drives order transitions and SMS exactly once', async () => {
    const { order, agent, shipmentId, claimId } = await acceptedClaim();
    const t = order.trackingToken;

    stub.advance(claimId, 'performer_found', courier);
    await yandex.syncDue(later(5));
    let s = await shipmentOf(order.id);
    expect(s.status).toBe('COURIER_ASSIGNED');
    expect(s.courier).toMatchObject({
      name: 'Aziz Karimov',
      plate: '01 A 123 BC',
      phone: '+79099999998',
      phoneExt: '0163',
    });
    expect((await orderOf(order.id)).status).toBe('CONFIRMED');

    // Courier phone: full for the browser that placed the order, masked for anyone with the link.
    const mine = await agent.get(`/v1/track/${t}`).expect(200);
    expect(mine.body.courier).toMatchObject({
      name: 'Aziz',
      phone: '+79099999998',
      phoneExt: '0163',
      car: 'oq Damas',
    });
    const other = await request(app.getHttpServer()).get(`/v1/track/${t}`).expect(200);
    expect(other.body.courier.phone).toBe('+7 *** *** 98');
    expect(other.body.courier.phoneExt).toBeNull();
    expect(other.body.contactPhone).toContain('***');

    stub.advance(claimId, 'pickuped');
    // Two overlapping job runs and a callback-triggered refresh: one transition, one SMS.
    await Promise.all([
      yandex.syncDue(later(10)),
      yandex.syncDue(later(10)),
      yandex.refresh(shipmentId),
    ]);
    await yandex.refresh(shipmentId);
    s = await shipmentOf(order.id);
    expect(s.status).toBe('PICKED_UP');
    expect((await orderOf(order.id)).status).toBe('HANDED_TO_COURIER');
    expect((await statusEvents(order.id)).map((e) => e.to)).toEqual([
      'CONFIRMED',
      'PACKING',
      'READY',
      'HANDED_TO_COURIER',
    ]);
    expect(await smsCount(order.customerId, 'order_courier')).toBe(1);
    const courierSms = await prisma.message.findFirstOrThrow({
      where: { customerId: order.customerId, templateKey: 'order_courier' },
    });
    expect(courierSms.body).toContain('14:40'); // points-eta 09:40Z → Tashkent time
    expect(courierSms.body).toContain(`/t/${t}`);

    stub.advance(claimId, 'delivered');
    await Promise.all([yandex.syncDue(later(20)), yandex.syncDue(later(20))]);
    stub.advance(claimId, 'delivered_finish');
    await yandex.syncDue(later(30));
    s = await shipmentOf(order.id);
    expect(s).toMatchObject({
      status: 'DELIVERED',
      providerStatus: 'delivered_finish',
      nextSyncAt: null,
    });
    expect((await orderOf(order.id)).status).toBe('DELIVERED');
    expect(await smsCount(order.customerId, 'order_delivered')).toBe(1);
    expect((await statusEvents(order.id)).filter((e) => e.to === 'DELIVERED')).toHaveLength(1);
    const history = s.history as { status: string }[];
    expect(history.map((h) => h.status)).toEqual([
      'CREATED',
      'COURIER_ASSIGNED',
      'PICKED_UP',
      'DELIVERED',
    ]);

    const track = await agent.get(`/v1/track/${t}`).expect(200);
    expect(track.body.deliveryStatus).toBe('DELIVERED');
    expect(track.body.courier.phone).toBeNull(); // no courier contact after delivery
    expect(track.body.history.map((h: { note: string }) => h.note)).toContain('Yetkazildi');
  });

  it('returning → returned: FAILED with one customer SMS, then the order is RETURNED', async () => {
    const { order, claimId } = await acceptedClaim();
    stub.advance(claimId, 'pickuped', courier);
    await yandex.syncDue(later(5));
    stub.advance(claimId, 'returning');
    await yandex.syncDue(later(10));
    await yandex.syncDue(later(11));
    expect((await shipmentOf(order.id)).status).toBe('FAILED');
    expect((await orderOf(order.id)).status).toBe('HANDED_TO_COURIER');
    expect(await smsCount(order.customerId, 'order_delivery_failed')).toBe(1);
    stub.advance(claimId, 'returned_finish');
    await yandex.syncDue(later(20));
    expect((await shipmentOf(order.id)).status).toBe('RETURNED');
    expect((await orderOf(order.id)).status).toBe('RETURNED');
  });

  it('cancel: free by default, paid needs consent, a cancelled claim can be re-created; address locks', async () => {
    const { order, shipmentId, claimId } = await acceptedClaim();
    const orders = app.get(OrdersService);
    await expect(
      orders.changeAddress(
        order.trackingToken,
        order.customerId,
        'Chilonzor 1-kvartal, 3-uy',
        null,
      ),
    ).rejects.toMatchObject({ code: 'ADDRESS_LOCKED' });

    stub.claims.get(claimId)!.cancelState = 'paid';
    await expect(yandex.cancelClaim(shipmentId, staff())).rejects.toMatchObject({
      code: 'DELIVERY_CANCEL_PAID',
    });
    stub.claims.get(claimId)!.cancelState = 'unavailable';
    await expect(
      yandex.cancelClaim(shipmentId, staff(), { allowPaid: true }),
    ).rejects.toMatchObject({
      code: 'DELIVERY_CANCEL_UNAVAILABLE',
    });
    stub.claims.get(claimId)!.cancelState = 'free';
    const cancelled = await yandex.cancelClaim(shipmentId, staff());
    expect(cancelled).toMatchObject({ status: 'FAILED', providerStatus: 'cancelled' });
    expect((await orderOf(order.id)).status).toBe('CONFIRMED');
    // The dead claim no longer locks the address.
    await orders.changeAddress(
      order.trackingToken,
      order.customerId,
      'Chilonzor 1-kvartal, 3-uy',
      null,
    );

    const again = await yandex.createClaim(order.id, staff());
    expect(again.claimId).not.toBe(claimId);
    expect(
      stub.calls
        .filter((c) => c.path === 'claims/create')
        .at(-1)
        ?.query.get('request_id'),
    ).toBe(`${shipmentId}-2`);
    expect((await shipmentOf(order.id)).status).toBe('CREATED');
  });

  it('API errors and timeouts do not corrupt state; failures back off per shipment', async () => {
    const { order } = await confirmedOrder();
    // A definitive 400 creates nothing and frees the request_id for the next attempt.
    stub.fail('claims/create', { status: 400, body: { code: 'address_not_found', message: 'x' } });
    const err = await yandex.createClaim(order.id, staff()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      code: 'DELIVERY_PROVIDER_ERROR',
      details: { status: 400, code: 'address_not_found' },
    });
    let s = await shipmentOf(order.id);
    expect(s.externalId).toBeNull();
    expect(s.status).toBe('NOT_CREATED');
    const created = await yandex.createClaim(order.id, staff());
    expect(
      stub.calls
        .filter((c) => c.path === 'claims/create')
        .at(-1)
        ?.query.get('request_id'),
    ).toBe(`${s.id}-2`);
    await yandex.acceptClaim(created.shipmentId, staff());

    // claims/info keeps failing (5xx after retries): nothing changes but the backoff.
    stub.advance(created.claimId!, 'pickuped', courier);
    stub.fail(`claims/info#${created.claimId}`, { status: 500 }, { status: 500 }, { status: 500 });
    const now = later(5);
    await yandex.syncDue(now);
    s = await shipmentOf(order.id);
    expect(s.status).toBe('CREATED');
    expect(s.syncFailures).toBe(1);
    expect(s.nextSyncAt!.getTime()).toBe(now.getTime() + 60_000);
    expect((await orderOf(order.id)).status).toBe('CONFIRMED');
    // A timed-out accept elsewhere / transient error clears on the next successful sync.
    await yandex.syncDue(later(7));
    s = await shipmentOf(order.id);
    expect(s).toMatchObject({ status: 'PICKED_UP', syncFailures: 0 });
    expect((await orderOf(order.id)).status).toBe('HANDED_TO_COURIER');
  });

  it('stale claims/info answers (older updated_ts) are ignored', async () => {
    const { order, shipmentId, claimId } = await acceptedClaim();
    stub.advance(claimId, 'performer_found', courier);
    await yandex.refresh(shipmentId);
    const c = stub.claims.get(claimId)!;
    c.status = 'accepted';
    c.updatedTs = new Date(Date.parse(c.updatedTs) - 60_000).toISOString();
    await yandex.refresh(shipmentId);
    expect((await shipmentOf(order.id)).status).toBe('COURIER_ASSIGNED');
  });

  it('status callback: wrong key → 403; right key enqueues a claims/info refresh', async () => {
    const { order, claimId } = await acceptedClaim();
    await request(app.getHttpServer())
      .post(`/v1/webhooks/yandex-delivery?key=nope&claim_id=${claimId}`)
      .expect(403);
    stub.advance(claimId, 'performer_found', courier);
    await request(app.getHttpServer())
      .post(
        `/v1/webhooks/yandex-delivery?key=${yandexCallbackKey(appSecret())}&claim_id=${claimId}&updated_ts=x`,
      )
      .expect(200, { ok: true });
    await request(app.getHttpServer())
      .post(`/v1/webhooks/yandex-delivery?key=${yandexCallbackKey(appSecret())}&claim_id=unknown`)
      .expect(200);
    for (let i = 0; i < 50 && (await shipmentOf(order.id)).status !== 'COURIER_ASSIGNED'; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect((await shipmentOf(order.id)).status).toBe('COURIER_ASSIGNED');
  });
  const reservationsOpen = async (orderId: string) =>
    (await prisma.reservation.findMany({ where: { orderId } })).filter((r) => !r.releasedAt).length;
  const attention = (orderId: string) =>
    prisma.orderEvent.findMany({ where: { orderId, type: 'DELIVERY_NEEDS_ATTENTION' } });

  it('refund / cancel are refused while a courier is dispatched; staff cancel the claim first', async () => {
    const { order, shipmentId } = await acceptedClaim();
    // COD settled with the courier (the only way a COD payment becomes refundable).
    const cod = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.payment.update({ where: { id: cod.id }, data: { status: 'PAID' } });
    const refund = () =>
      lifecycle.recordManualRefund(cod.id, {
        amountTiyin: order.totalTiyin,
        reason: 'customer cancelled',
        staffId: ownerId,
      });
    await expect(refund()).rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED' });
    await expect(
      prisma.$transaction((tx) => lifecycle.transition(tx, order.id, 'CANCELLED', staff())),
    ).rejects.toMatchObject({ code: 'DELIVERY_IN_PROGRESS' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: cod.id } })).status).toBe('PAID');
    expect(await reservationsOpen(order.id)).toBe(1);

    await yandex.cancelClaim(shipmentId, staff());
    expect(await refund()).toMatchObject({ full: true });
    expect((await orderOf(order.id)).status).toBe('CANCELLED');
    expect(await reservationsOpen(order.id)).toBe(0);
  });

  it("a carrier moving a cancelled order's parcel is flagged, never silently dropped", async () => {
    const { order, claimId } = await acceptedClaim();
    // E.g. accepted in the Yandex cabinet after the order was cancelled here.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    stub.advance(claimId, 'pickuped', courier);
    await yandex.syncDue(later(5));
    expect((await shipmentOf(order.id)).status).toBe('PICKED_UP');
    expect((await orderOf(order.id)).status).toBe('CANCELLED');
    expect((await attention(order.id)).map((e) => e.data)).toEqual([
      expect.objectContaining({
        reason: 'cancelled_order_parcel_moved',
        providerStatus: 'pickuped',
      }),
    ]);
    expect(await smsCount(order.customerId, 'order_courier')).toBe(0);
  });

  it('return seen without pickuped: handed over silently, one failed SMS despite bouncing, stock released', async () => {
    const { order, claimId } = await acceptedClaim();
    stub.advance(claimId, 'returning', courier);
    await yandex.syncDue(later(5));
    expect((await shipmentOf(order.id)).status).toBe('FAILED');
    expect((await orderOf(order.id)).status).toBe('HANDED_TO_COURIER');
    // HANDED_TO_COURIER means no online address change / refund any more.
    const track = await request(app.getHttpServer()).get(`/v1/track/${order.trackingToken}`);
    expect(track.body.canChangeAddress).toBe(false);
    stub.advance(claimId, 'delivery_arrived');
    await yandex.syncDue(later(10));
    expect((await shipmentOf(order.id)).status).toBe('IN_TRANSIT');
    stub.advance(claimId, 'returning');
    await yandex.syncDue(later(15));
    stub.advance(claimId, 'returned');
    await yandex.syncDue(later(20));
    expect((await shipmentOf(order.id)).status).toBe('RETURNED');
    expect((await orderOf(order.id)).status).toBe('RETURNED');
    expect(await smsCount(order.customerId, 'order_delivery_failed')).toBe(1);
    expect(await smsCount(order.customerId, 'order_courier')).toBe(0);
    expect(await smsCount(order.customerId, 'order_shipped')).toBe(0);
    expect(await reservationsOpen(order.id)).toBe(0);
  });

  it('claim dies with the parcel out: attention event, no new claim, staff mark it returned', async () => {
    const { order, shipmentId, claimId } = await acceptedClaim();
    stub.advance(claimId, 'cancelled_with_items_on_hands', courier);
    await yandex.syncDue(later(5));
    const s = await shipmentOf(order.id);
    expect(s).toMatchObject({ status: 'FAILED', nextSyncAt: null });
    expect((await orderOf(order.id)).status).toBe('HANDED_TO_COURIER');
    expect((await attention(order.id)).map((e) => (e.data as { reason: string }).reason)).toEqual([
      'failed_after_pickup',
    ]);
    expect(await smsCount(order.customerId, 'order_delivery_failed')).toBe(1);
    await expect(yandex.createClaim(order.id, staff())).rejects.toMatchObject({
      code: 'SHIPMENT_ORDER_NOT_READY',
    });
    expect(await reservationsOpen(order.id)).toBe(1);
    await yandex.markReturned(shipmentId, staff());
    expect((await shipmentOf(order.id)).status).toBe('RETURNED');
    expect((await orderOf(order.id)).status).toBe('RETURNED');
    expect(await reservationsOpen(order.id)).toBe(0);
    await expect(yandex.markReturned(shipmentId, staff())).rejects.toMatchObject({
      code: 'DELIVERY_INVALID_TRANSITION',
    });
  });

  it('address change drops the checkout pin; a create with a lost answer locks the address', async () => {
    const { order } = await placeCod({ lat: 41.3611, lng: 69.2891 });
    await lifecycle.confirmCod(order.id, staff());
    const orders = app.get(OrdersService);
    expect(order.address).toMatchObject({ lat: 41.3611, lng: 69.2891 });
    await orders.changeAddress(
      order.trackingToken,
      order.customerId,
      'Chilonzor 1-kvartal, 3-uy',
      null,
    );
    const moved = (await orderOf(order.id)).address as Record<string, unknown>;
    expect(moved).toMatchObject({ line: 'Chilonzor 1-kvartal, 3-uy', district: 'yunusobod' });
    expect(moved).not.toHaveProperty('lat');
    expect(moved).not.toHaveProperty('lng');

    // Every attempt reaches Yandex but no answer comes back: the claim may exist there.
    stub.fail('claims/create', 'reset-after', 'reset-after', 'reset-after');
    await expect(yandex.createClaim(order.id, staff())).rejects.toMatchObject({
      code: 'DELIVERY_PROVIDER_ERROR',
    });
    expect((await shipmentOf(order.id)).externalId).toBeNull();
    await expect(
      orders.changeAddress(order.trackingToken, order.customerId, 'Olmazor 2-uy, 7-xonadon', null),
    ).rejects.toMatchObject({ code: 'ADDRESS_LOCKED' });
    const track = await request(app.getHttpServer()).get(`/v1/track/${order.trackingToken}`);
    expect(track.body.canChangeAddress).toBe(false);
    // The retry gets the claim Yandex made first: with the address it had then (no pin).
    const created = await yandex.createClaim(order.id, staff());
    const dest = (
      stub.claims.get(created.claimId!)!.body as {
        route_points: { address: { fullname: string; coordinates?: number[] } }[];
      }
    ).route_points[1]!.address;
    expect(dest.fullname).toContain('Chilonzor 1-kvartal, 3-uy');
    expect(dest.coordinates).toBeUndefined();
  });

  it('accept: an accept in flight makes a second one a no-op; a failed accept frees the claim', async () => {
    const { order } = await confirmedOrder();
    const created = await yandex.createClaim(order.id, staff());
    const setRequest = async (agoMs: number) => {
      const s = await shipmentOf(order.id);
      await prisma.shipment.update({
        where: { id: s.id },
        data: {
          providerData: {
            ...(s.providerData as object),
            acceptRequest: {
              by: 'other-staff',
              at: new Date(Date.now() - agoMs).toISOString(),
              claimId: created.claimId,
            },
          },
        },
      });
    };
    const accepts = stub.count('claims/accept');
    await setRequest(10_000); // another staff member's accept is still running
    expect((await yandex.acceptClaim(created.shipmentId, staff())).acceptedAt).toBeNull();
    expect(stub.count('claims/accept')).toBe(accepts);
    await setRequest(3 * 60_000); // that process died: the lease is over
    stub.fail('claims/accept', { status: 500 });
    await expect(yandex.acceptClaim(created.shipmentId, staff())).rejects.toMatchObject({
      code: 'DELIVERY_PROVIDER_ERROR',
    });
    let s = await shipmentOf(order.id);
    expect(s.acceptedAt).toBeNull();
    expect((s.providerData as { acceptRequest: unknown }).acceptRequest).toBeNull();
    await yandex.acceptClaim(created.shipmentId, staff());
    s = await shipmentOf(order.id);
    expect(s.acceptedAt).not.toBeNull();
    expect(stub.count('claims/accept')).toBe(accepts + 2);
    const ev = await prisma.orderEvent.findMany({
      where: { orderId: order.id, type: 'DELIVERY_ACCEPTED' },
    });
    expect(ev).toEqual([expect.objectContaining({ actorType: 'STAFF', actorId: ownerId })]);
  });

  it('polling stops for claims nobody accepts and for cancelled orders (stock released)', async () => {
    const a = await confirmedOrder();
    const stale = await yandex.createClaim(a.order.id, staff());
    const s = await shipmentOf(a.order.id);
    await prisma.shipment.update({
      where: { id: s.id },
      data: {
        providerData: {
          ...(s.providerData as object),
          claimCreatedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
        },
      },
    });
    await yandex.refresh(stale.shipmentId);
    expect((await shipmentOf(a.order.id)).nextSyncAt).toBeNull();

    const b = await confirmedOrder();
    const fresh = await yandex.createClaim(b.order.id, staff());
    await yandex.refresh(fresh.shipmentId);
    expect((await shipmentOf(b.order.id)).nextSyncAt).not.toBeNull();
    // Not accepted yet: the order may still be cancelled; that frees its stock hold.
    await prisma.$transaction((tx) => lifecycle.transition(tx, b.order.id, 'CANCELLED', staff()));
    expect(await reservationsOpen(b.order.id)).toBe(0);
    await yandex.refresh(fresh.shipmentId);
    expect((await shipmentOf(b.order.id)).nextSyncAt).toBeNull();
    // Staff accept/refresh would restart it; the claim itself is untouched at Yandex.
    expect(stub.claims.get(fresh.claimId!)?.status).toBe('ready_for_approval');
  });

  it('live quotes: own breaker, no retries, failures cached per pin, pins rate-limited per IP', async () => {
    const zones = await settings.get('delivery.zones');
    await settings.set(
      'delivery.zones',
      zones.map((z) => (z.key === 'tashkent-city-yandex' ? { ...z, liveQuote: true } : z)),
    );
    try {
      const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
      const agent = shopper(app);
      await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
      const price = async (lat: number) =>
        (
          await agent.get(`/v1/cart/quote?region=tashkent_city&lat=${lat}&lng=69.3001`).expect(200)
        ).body.find((o: { zoneKey: string }) => o.zoneKey === 'tashkent-city-yandex')?.priceSoum;
      const before = stub.count('check-price');
      stub.fail('check-price', ...Array.from({ length: 5 }, () => ({ status: 500 })));
      expect(await price(41.2001)).toBe(30_000); // zone price
      expect(stub.count('check-price')).toBe(before + 1); // one attempt, no retries
      expect(await price(41.2001)).toBe(30_000);
      expect(stub.count('check-price')).toBe(before + 1); // failed pin cached
      for (const lat of [41.2101, 41.2201, 41.2301, 41.2401]) await price(lat);
      expect(stub.count('check-price')).toBe(before + 5);
      expect(await price(41.2501)).toBe(30_000); // quote breaker open: Yandex not called
      expect(stub.count('check-price')).toBe(before + 5);
      // Claims use the other breaker and still work.
      const { order } = await confirmedOrder();
      expect((await yandex.createClaim(order.id, staff())).claimId).toBeTruthy();

      // 30 pinned requests per minute per IP (quotes + pinned cart totals), then 429.
      const ip = shopper(app);
      await ip.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
      for (let i = 0; i < 29; i++)
        await ip.get('/v1/cart/quote?region=tashkent_city&lat=41.2001&lng=69.3001').expect(200);
      await ip.get('/v1/cart?zone=tashkent-city-yandex&lat=41.2001&lng=69.3001').expect(200);
      const limited = await ip
        .get('/v1/cart?zone=tashkent-city-yandex&lat=41.2001&lng=69.3001')
        .expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      await ip.get('/v1/cart/quote?region=tashkent_city').expect(200); // no pin: not limited
    } finally {
      await settings.set('delivery.zones', zones);
    }
  });

  it('status callback: a repeated claim_id is answered, not a 500', async () => {
    const { claimId } = await acceptedClaim();
    const key = yandexCallbackKey(appSecret());
    await request(app.getHttpServer())
      .post(`/v1/webhooks/yandex-delivery?key=${key}&claim_id=${claimId}&claim_id=other`)
      .expect(200, { ok: true });
    await request(app.getHttpServer())
      .post(`/v1/webhooks/yandex-delivery?key=${key}&key=x&claim_id[a]=1`)
      .expect(200, { ok: true });
  });
});
