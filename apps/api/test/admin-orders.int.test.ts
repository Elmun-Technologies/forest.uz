import { randomBytes } from 'node:crypto';
import type {
  AdminOrderDetailDto,
  AdminOrderPageDto,
  AdminOrderPiiDto,
  StaffRole,
} from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { DELIVERY_QUEUE, SYNC_JOB } from '../src/delivery/delivery.module';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';
import { nextTestIp, shopper } from './app';
import { YandexStub } from './yandex-stub';

/**
 * Admin orders (A6/A7): list tabs/filters/cursor pages, RBAC on every route, each action's state
 * change + OrderEvent + AuditLog row, Yandex create/accept/cancel against the stub (test mode
 * refusal), cancel/refund refused while a courier is out, manual phone order idempotency, CSV
 * masking and the audited PII reveal.
 */
describe('admin orders (integration)', () => {
  const stub = new YandexStub();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let lifecycle: OrderLifecycleService;
  let integrations: IntegrationsService;
  const as = {} as Record<StaffRole, { client: AdminClient; id: string }>;
  // Phones `+99893<run 4 digits><seq 3 digits>`: `q=93<run>` finds exactly this run's orders.
  const run = String(Math.floor(1000 + Math.random() * 8999));
  const runQuery = `93${run}`;
  let seq = 0;

  const yandexCredentials = (over: Record<string, string> = {}) => ({
    oauthToken: stub.token,
    sourceAddress: 'Toshkent, Chilonzor 9-kvartal, 5-uy',
    sourceLat: '41.2850',
    sourceLng: '69.2040',
    sourceContactName: 'Forest ombor',
    sourceContactPhone: '+998901234567',
    allowCod: 'on',
    callbacks: 'off',
    mode: 'live',
    ...over,
  });

  async function place(
    carrier: 'YANDEX' | 'BTS' = 'YANDEX',
  ): Promise<{ id: string; number: string; phone: string }> {
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CL-0500' } })).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const phone = `+99893${run}${String(++seq).padStart(3, '0')}`;
    const res = await agent
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', nextTestIp())
      .set('Idempotency-Key', `ao-${run}-${seq}-${Date.now()}`)
      .send({
        name: `Malika ${run}`,
        phone,
        region: carrier === 'YANDEX' ? 'tashkent_city' : 'samarkand',
        district: carrier === 'YANDEX' ? 'yunusobod' : null,
        addressLine: 'Yunusobod 4-kvartal, 12-uy',
        zoneKey: carrier === 'YANDEX' ? 'tashkent-city-yandex' : 'regions-bts',
        paymentMethod: 'COD',
        offerVersion: 'v1',
      })
      .expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
    return { id: o.id, number: o.number, phone };
  }

  const staffActor = () => ({ type: 'STAFF' as const, id: as.OWNER.id });
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const audits = (orderId: string, action: string) =>
    prisma.auditLog.findMany({
      where: { entityId: orderId, action },
      orderBy: { createdAt: 'asc' },
    });
  const events = (orderId: string, type: string) =>
    prisma.orderEvent.findMany({ where: { orderId, type }, orderBy: { createdAt: 'asc' } });
  const url = (number: string, path = '') => `/v1/admin/orders/${number}${path}`;
  const post = (role: StaffRole, path: string, body?: object) => as[role].client.post(path, body);
  /** Mutations that need an Idempotency-Key (refunds, manual orders). */
  async function postKeyed(role: StaffRole, path: string, body: object, key: string) {
    const c = as[role].client;
    if (!c.csrf) await c.get('/v1/admin/auth/csrf');
    return c.agent
      .post(path)
      .set('X-Forwarded-For', c.ip)
      .set('X-CSRF-Token', c.csrf ?? '')
      .set('Idempotency-Key', key)
      .send(body);
  }
  const detail = async (role: StaffRole, number: string) => {
    const res = await as[role].client.get(url(number));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as AdminOrderDetailDto;
  };
  const codPaymentId = async (orderId: string) =>
    (await prisma.payment.findFirstOrThrow({ where: { orderId, method: 'COD' } })).id;

  beforeAll(async () => {
    await stub.start();
    app = await createAdminTestApp([], {
      PROVIDERS_MODE: 'sandbox',
      YANDEX_DELIVERY_API_URL: stub.url,
    });
    prisma = app.get(PrismaService);
    lifecycle = app.get(OrderLifecycleService);
    integrations = app.get(IntegrationsService);
    await app.get<Queue>(getQueueToken(DELIVERY_QUEUE)).removeJobScheduler(SYNC_JOB);
    for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const)
      as[role] = await signedIn(app, role);
    const health = await integrations.connect(
      'yandex_delivery',
      yandexCredentials(),
      as.OWNER.id,
      null,
    );
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

  it('RBAC: every route is permission-gated per docs/02', async () => {
    const missing = 'F-99999999';
    const table: [string, 'get' | 'post', string, StaffRole[]][] = [
      ['list', 'get', '/v1/admin/orders', ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['badge', 'get', '/v1/admin/orders/badge', ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['detail', 'get', url(missing), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['pii', 'post', url(missing, '/pii'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['confirm', 'post', url(missing, '/confirm'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['codPaid', 'post', url(missing, '/cod-paid'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      [
        'delivered',
        'post',
        url(missing, '/delivered'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      [
        'yandexRefresh',
        'post',
        url(missing, '/yandex/refresh'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      [
        'yandexReturned',
        'post',
        url(missing, '/yandex/returned'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      ['manual', 'post', '/v1/admin/orders', ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['packing', 'post', url(missing, '/packing'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['ready', 'post', url(missing, '/ready'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['bts', 'post', url(missing, '/bts'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      [
        'claim',
        'post',
        url(missing, '/yandex/claim'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      [
        'accept',
        'post',
        url(missing, '/yandex/accept'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      ['receipt', 'post', url(missing, '/receipt'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      [
        'complete',
        'post',
        url(missing, '/complete'),
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
      ['notes', 'post', url(missing, '/notes'), ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      ['cancel', 'post', url(missing, '/cancel'), ['OWNER', 'MANAGER']],
      ['refunds', 'post', url(missing, '/refunds'), ['OWNER', 'MANAGER']],
      ['export', 'post', '/v1/admin/orders/export', ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE']],
      [
        'variants',
        'get',
        '/v1/admin/orders/variants',
        ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'],
      ],
    ];
    const bodies: Record<string, object> = {
      bts: { status: 'CREATED', trackNumber: 'BTS-1' },
      receipt: { receiptNumber: 'FK-1' },
      notes: { text: 'salom' },
      cancel: { reason: 'mijoz rad etdi' },
      refunds: { paymentId: 'p', amountSoum: 1, reason: 'qaytarish' },
    };
    for (const [name, method, path, allowed] of table)
      for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const) {
        const res =
          method === 'get'
            ? await as[role].client.get(path)
            : await post(role, path, bodies[name] ?? {});
        const forbidden = res.status === 403 && res.body?.error?.code === 'FORBIDDEN';
        expect(forbidden, `${name} as ${role}: ${res.status} ${JSON.stringify(res.body)}`).toBe(
          !allowed.includes(role),
        );
      }
    // Paid Yandex cancel needs cancel_refund on top of orders.edit.
    const opPaid = await post('OPERATOR', url(missing, '/yandex/cancel'), { allowPaid: true });
    expect(opPaid.body.error.code).toBe('FORBIDDEN');
    // CSRF: a mutation without the token is refused before anything runs.
    const noCsrf = await as.OWNER.client.post(url(missing, '/confirm'), {}, { csrf: null });
    expect(noCsrf.body.error.code).toBe('ADMIN_CSRF_INVALID');
  });

  it('list: tabs with counts, filters, search, masked phones, cursor pages', async () => {
    const a = await place('YANDEX'); // stays NEW → confirm
    const b = await place('BTS');
    await lifecycle.confirmCod(b.id, staffActor()); // → to_pack
    const c = await place('YANDEX');
    await lifecycle.confirmCod(c.id, staffActor());
    await prisma.order.update({
      where: { id: c.id },
      data: { slaDueAt: new Date(Date.now() + 20 * 60_000) },
    });
    const d = await place('BTS');
    await post('OWNER', url(d.number, '/cancel'), { reason: 'mijoz rad etdi' }).then((r) =>
      expect(r.status).toBe(200),
    );

    const res = await as.OPERATOR.client.get(`/v1/admin/orders?q=${runQuery}&limit=2`);
    expect(res.status).toBe(200);
    const page = res.body as AdminOrderPageDto;
    expect(page.counts).toMatchObject({
      all: 4,
      confirm: 1,
      to_pack: 2,
      sla_risk: 1,
      cancelled: 1,
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.customer.phoneMasked).toMatch(/^\+998 93 \*\*\* \*\* \d\d$/);
    expect(JSON.stringify(page)).not.toContain(a.phone);
    const second = (
      await as.OPERATOR.client.get(
        `/v1/admin/orders?q=${runQuery}&limit=2&cursor=${page.nextCursor}`,
      )
    ).body as AdminOrderPageDto;
    const ids = [...page.items, ...second.items].map((i) => i.number);
    expect(new Set(ids)).toEqual(new Set([a.number, b.number, c.number, d.number]));
    expect(second.nextCursor).toBeNull();

    const tab = async (qs: string) =>
      (
        (await as.OPERATOR.client.get(`/v1/admin/orders?q=${runQuery}&${qs}`))
          .body as AdminOrderPageDto
      ).items.map((i) => i.number);
    expect(await tab('tab=confirm')).toEqual([a.number]);
    expect(await tab('tab=sla_risk')).toEqual([c.number]);
    expect((await tab('tab=to_pack&carrier=BTS')).sort()).toEqual([b.number]);
    expect(await tab('sort=sla_asc&tab=to_pack')).toEqual([c.number, b.number]);
    const byNumber = await as.OPERATOR.client.get(`/v1/admin/orders?q=${a.number}`);
    expect((byNumber.body as AdminOrderPageDto).items.map((i) => i.number)).toEqual([a.number]);
    const sla = (await as.OPERATOR.client.get(`/v1/admin/orders?q=${runQuery}&tab=sla_risk`))
      .body as AdminOrderPageDto;
    expect(sla.items[0]!.sla).toBe('AT_RISK');
    // Bad cursor: a validation error, never a 500.
    const bad = await as.OPERATOR.client.get('/v1/admin/orders?cursor=bm9wZQ');
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    // Phone digits: > 4 only with customers.pii (Warehouse can't confirm a masked number).
    const digits = a.phone.slice(4);
    const byPhone = async (role: StaffRole, q: string) =>
      ((await as[role].client.get(`/v1/admin/orders?q=${q}`)).body as AdminOrderPageDto).items.map(
        (i) => i.number,
      );
    expect(await byPhone('OPERATOR', digits)).toEqual([a.number]);
    expect(await byPhone('WAREHOUSE', digits)).toEqual([]);
    expect(await byPhone('WAREHOUSE', digits.slice(-4))).toContain(a.number);
    const whExport = await post('WAREHOUSE', '/v1/admin/orders/export', { q: digits });
    expect(whExport.text).not.toContain(a.number);
    const badge = await as.WAREHOUSE.client.get('/v1/admin/orders/badge');
    expect(badge.body.count).toBeGreaterThanOrEqual(3);
  });

  it('BTS flow: confirm → packing → ready → waybill → delivered → receipt → complete', async () => {
    const o = await place('BTS');
    const r1 = await post('OPERATOR', url(o.number, '/confirm'));
    expect(r1.body).toEqual({ ok: true, noop: false });
    expect((await orderOf(o.id)).status).toBe('CONFIRMED');
    expect((await orderOf(o.id)).slaDueAt).not.toBeNull();
    expect(await audits(o.id, 'order.cod_confirmed')).toHaveLength(1);
    const confirmed = await events(o.id, 'STATUS_CHANGED');
    expect(confirmed.at(-1)).toMatchObject({
      to: 'CONFIRMED',
      actorType: 'STAFF',
      actorId: as.OPERATOR.id,
    });
    // Double click: no-op, still audited.
    expect((await post('OPERATOR', url(o.number, '/confirm'))).body).toEqual({
      ok: true,
      noop: true,
    });
    expect(await audits(o.id, 'order.cod_confirmed')).toHaveLength(2);

    expect((await post('WAREHOUSE', url(o.number, '/packing'))).status).toBe(200);
    expect((await post('WAREHOUSE', url(o.number, '/ready'))).status).toBe(200);
    expect((await orderOf(o.id)).status).toBe('READY');
    expect(await audits(o.id, 'order.packing_started')).toHaveLength(1);
    const skip = await post('WAREHOUSE', url(o.number, '/packing'));
    expect(skip.body.error.code).toBe('ORDER_INVALID_TRANSITION');

    const created = await post('OPERATOR', url(o.number, '/bts'), {
      status: 'PICKED_UP',
      trackNumber: `BTS-${run}`,
    });
    expect(created.status).toBe(200);
    expect((await orderOf(o.id)).status).toBe('HANDED_TO_COURIER');
    expect(await audits(o.id, 'order.shipment_updated')).toHaveLength(1);
    // While BTS has the parcel the order can't be cancelled.
    const owner = await detail('OWNER', o.number);
    expect(owner.actions.map((a) => a.key)).not.toContain('cancel');

    await post('OPERATOR', url(o.number, '/bts'), { status: 'DELIVERED' });
    expect((await orderOf(o.id)).status).toBe('DELIVERED');
    // COD cash from the courier: payment PAID (no SMS), double click is a no-op.
    expect((await post('OPERATOR', url(o.number, '/cod-paid'))).body).toEqual({
      ok: true,
      noop: false,
    });
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } })).status).toBe(
      'PAID',
    );
    expect((await events(o.id, 'PAYMENT_PAID')).at(-1)).toMatchObject({ actorType: 'STAFF' });
    expect((await post('OPERATOR', url(o.number, '/cod-paid'))).body.noop).toBe(true);
    expect(await audits(o.id, 'order.cod_settled')).toHaveLength(2);
    const early = await post('OPERATOR', url(o.number, '/complete'));
    expect(early.body.error.code).toBe('FISCAL_RECEIPT_REQUIRED');
    const d1 = await detail('OPERATOR', o.number);
    expect(d1.actions.find((a) => a.key === 'complete')?.blockedBy).toBe('FISCAL_RECEIPT_REQUIRED');

    expect(
      (await post('OPERATOR', url(o.number, '/receipt'), { receiptNumber: `FK-${run}` })).status,
    ).toBe(200);
    const [rec] = await audits(o.id, 'order.fiscal_receipt_recorded');
    expect(rec).toMatchObject({ staffId: as.OPERATOR.id });
    expect((await post('OPERATOR', url(o.number, '/complete'))).status).toBe(200);
    expect((await orderOf(o.id)).status).toBe('COMPLETED');
    expect(await audits(o.id, 'order.completed')).toHaveLength(1);

    const d = await detail('OPERATOR', o.number);
    expect(d.steps.every((s) => s.state === 'done' || s.key === 'COMPLETED')).toBe(true);
    expect(d.shipments[0]).toMatchObject({
      carrier: 'BTS',
      status: 'DELIVERED',
      trackNumber: `BTS-${run}`,
    });
    expect(d.fiscal.receipt?.receiptNumber).toBe(`FK-${run}`);
    expect(d.timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(['CREATED', 'STATUS_CHANGED', 'DELIVERY_STATUS', 'FISCAL_RECEIPT']),
    );
    expect(d.customer).toMatchObject({ nth: 1 });
  });

  it('Yandex: create (estimate) → accept, cancel/refund refused while the courier is out, claim cancel unblocks', async () => {
    const unpaid = await place('YANDEX');
    await post('OPERATOR', url(unpaid.number, '/confirm'));
    const paid = await place('YANDEX');
    await lifecycle.markPaid(await codPaymentId(paid.id), staffActor());
    expect((await orderOf(paid.id)).status).toBe('CONFIRMED');

    for (const o of [unpaid, paid]) {
      const c1 = await post('OPERATOR', url(o.number, '/yandex/claim'));
      expect(c1.body).toEqual({ ok: true, noop: false });
      expect(await events(o.id, 'DELIVERY_CLAIM_CREATED')).toHaveLength(1);
      expect(await audits(o.id, 'order.yandex_claim_created')).toHaveLength(1);
      // Second click returns the same claim.
      expect((await post('OPERATOR', url(o.number, '/yandex/claim'))).body.noop).toBe(true);
      expect((await detail('OPERATOR', o.number)).actions.map((a) => a.key)).toContain(
        'yandex_accept_claim',
      );
      const acc = await post('OPERATOR', url(o.number, '/yandex/accept'));
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(await events(o.id, 'DELIVERY_ACCEPTED')).toHaveLength(1);
      expect(await audits(o.id, 'order.yandex_claim_accepted')).toHaveLength(1);
    }

    const cancel = await post('MANAGER', url(unpaid.number, '/cancel'), {
      reason: 'mijoz rad etdi',
    });
    expect(cancel.body.error.code).toBe('DELIVERY_IN_PROGRESS');
    const paidCancel = await post('MANAGER', url(paid.number, '/cancel'), {
      reason: 'mijoz rad etdi',
    });
    expect(paidCancel.body.error.code).toBe('ORDER_PAID_REFUND_FIRST');
    const pay = await codPaymentId(paid.id);
    const refundBody = {
      paymentId: pay,
      amountSoum: (await detail('OWNER', paid.number)).totals.totalSoum,
      reason: 'mijoz rad etdi',
    };
    const refused = await postKeyed(
      'MANAGER',
      url(paid.number, '/refunds'),
      refundBody,
      `rf-${run}-a-${randomBytes(6).toString('hex')}`,
    );
    expect(refused.body.error.code).toBe('REFUND_NOT_ALLOWED');
    expect(await prisma.refund.count({ where: { paymentId: pay } })).toBe(0);

    for (const o of [unpaid, paid]) {
      const cc = await post('MANAGER', url(o.number, '/yandex/cancel'), { allowPaid: false });
      expect(cc.status, JSON.stringify(cc.body)).toBe(200);
      expect(await audits(o.id, 'order.yandex_claim_cancelled')).toHaveLength(1);
    }
    expect(
      (await post('MANAGER', url(unpaid.number, '/cancel'), { reason: 'mijoz rad etdi' })).status,
    ).toBe(200);
    const u = await orderOf(unpaid.id);
    expect(u).toMatchObject({ status: 'CANCELLED', cancelReason: 'mijoz rad etdi' });
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: unpaid.id } })).status).toBe(
      'EXPIRED',
    );
    expect(
      await prisma.reservation.count({ where: { orderId: unpaid.id, releasedAt: null } }),
    ).toBe(0);
    expect(await audits(unpaid.id, 'order.cancelled')).toHaveLength(1);

    // Full refund before shipping cancels the paid order; replay with the same key is idempotent.
    const key = `rf-${run}-b-${randomBytes(6).toString('hex')}`;
    const r1 = await postKeyed('MANAGER', url(paid.number, '/refunds'), refundBody, key);
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.full).toBe(true);
    const r2 = await postKeyed('MANAGER', url(paid.number, '/refunds'), refundBody, key);
    expect(r2.body.refundId).toBe(r1.body.refundId);
    expect(await prisma.refund.count({ where: { paymentId: pay } })).toBe(1);
    const conflict = await postKeyed(
      'MANAGER',
      url(paid.number, '/refunds'),
      { ...refundBody, amountSoum: 1 },
      key,
    );
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await orderOf(paid.id)).status).toBe('CANCELLED');
    expect(await audits(paid.id, 'order.refund_recorded')).toHaveLength(2);
    const noKey = await post('MANAGER', url(paid.number, '/refunds'), refundBody);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('Yandex test mode: claims are estimated, accept is refused and surfaced', async () => {
    await integrations.connect(
      'yandex_delivery',
      yandexCredentials({ mode: 'test' }),
      as.OWNER.id,
      null,
    );
    try {
      const o = await place('YANDEX');
      await post('OPERATOR', url(o.number, '/confirm'));
      expect((await post('OPERATOR', url(o.number, '/yandex/claim'))).status).toBe(200);
      const calls = stub.count('claims/accept');
      const acc = await post('OPERATOR', url(o.number, '/yandex/accept'));
      expect(acc.body.error.code).toBe('DELIVERY_TEST_MODE');
      expect(stub.count('claims/accept')).toBe(calls);
      expect(await audits(o.id, 'order.yandex_claim_accepted')).toHaveLength(0);
    } finally {
      await integrations.connect('yandex_delivery', yandexCredentials(), as.OWNER.id, null);
    }
  });

  it('Payme refunds go through the provider cabinet; Warehouse never sees refund/cancel', async () => {
    const o = await place('YANDEX');
    const pay = await codPaymentId(o.id);
    await lifecycle.markPaid(pay, staffActor());
    await prisma.payment.update({ where: { id: pay }, data: { method: 'PAYME' } });
    const owner = await detail('OWNER', o.number);
    expect(owner.actions.find((a) => a.key === 'refund')?.blockedBy).toBe(
      'REFUND_VIA_PROVIDER_CABINET',
    );
    // Customer card LTV = paid payments minus refunds (A4/A5 definition).
    expect(owner.customer?.ltvSoum).toBe(owner.totals.totalSoum);
    const res = await postKeyed(
      'OWNER',
      url(o.number, '/refunds'),
      { paymentId: pay, amountSoum: 1000, reason: 'qisman' },
      `rf-${run}-c-${randomBytes(6).toString('hex')}`,
    );
    expect(res.body.error.code).toBe('REFUND_VIA_PROVIDER_CABINET');
    const wh = await detail('WAREHOUSE', o.number);
    const keys = wh.actions.map((a) => a.key);
    expect(keys).not.toContain('refund');
    expect(keys).not.toContain('cancel');
    expect(keys).toContain('start_packing');
  });

  it('PICKUP: mark delivered walks order and shipment state machines with history', async () => {
    const o = await place('BTS');
    await post('OPERATOR', url(o.number, '/confirm'));
    await prisma.order.update({ where: { id: o.id }, data: { carrier: 'PICKUP' } });
    await prisma.shipment.updateMany({ where: { orderId: o.id }, data: { carrier: 'PICKUP' } });
    const res = await post('WAREHOUSE', url(o.number, '/delivered'));
    expect(res.body).toEqual({ ok: true, noop: false });
    expect((await orderOf(o.id)).status).toBe('DELIVERED');
    const s = await prisma.shipment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(s.status).toBe('DELIVERED');
    expect((s.history as { status: string }[]).map((h) => h.status)).toEqual([
      'CREATED',
      'DELIVERED',
    ]);
    expect(await events(o.id, 'DELIVERY_STATUS')).toHaveLength(1);
    expect(await audits(o.id, 'order.delivered')).toHaveLength(1);
    expect((await post('WAREHOUSE', url(o.number, '/delivered'))).body.noop).toBe(true);
  });

  it('PII: detail is masked; reveal is permission-scoped and audited', async () => {
    const o = await place('YANDEX');
    const d = await detail('OPERATOR', o.number);
    expect(JSON.stringify(d)).not.toContain(o.phone);
    expect(JSON.stringify(d)).not.toContain('12-uy');
    const op = await post('OPERATOR', url(o.number, '/pii'));
    expect(op.status).toBe(200);
    expect((op.body as AdminOrderPiiDto).phone).toContain(o.phone.slice(-2));
    expect((op.body as AdminOrderPiiDto).address?.line).toContain('12-uy');
    const wh = await post('WAREHOUSE', url(o.number, '/pii'));
    expect(wh.body).toMatchObject({ phone: null, address: { line: 'Yunusobod 4-kvartal, 12-uy' } });
    const logs = await audits(o.id, 'order.view_pii');
    expect(logs.map((l) => l.after)).toEqual([
      { fields: ['contactPhone', 'address'] },
      { fields: ['address'] },
    ]);
    expect(JSON.stringify(logs)).not.toContain('12-uy');
  });

  it('notes: staff-only timeline entry, audit stores the event id only', async () => {
    const o = await place('BTS');
    expect(
      (await post('WAREHOUSE', url(o.number, '/notes'), { text: 'Qopqoq yorilgan, almashtirildi' }))
        .status,
    ).toBe(200);
    const d = await detail('WAREHOUSE', o.number);
    expect(d.timeline.at(-1)).toMatchObject({
      type: 'NOTE',
      note: 'Qopqoq yorilgan, almashtirildi',
    });
    const [log] = await audits(o.id, 'order.note_added');
    expect(JSON.stringify(log?.after)).not.toContain('Qopqoq');
  });

  it('manual phone order: checkout path, source=phone, idempotent', async () => {
    const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CL-0500' } });
    const options = await as.OPERATOR.client.get('/v1/admin/orders/variants?q=FR-CL');
    expect(options.body.map((v: { id: string }) => v.id)).toContain(variant.id);
    const body = {
      name: 'Telefon Mijoz',
      phone: `+99893${run}999`,
      region: 'tashkent_city',
      district: 'chilonzor',
      addressLine: 'Chilonzor 9-kvartal, 5-uy',
      zoneKey: 'tashkent-city-yandex',
      lines: [{ variantId: variant.id, qty: 2 }],
    };
    const key = `mo-${run}-${randomBytes(6).toString('hex')}`;
    const r1 = await postKeyed('OPERATOR', '/v1/admin/orders', body, key);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const r2 = await postKeyed('OPERATOR', '/v1/admin/orders', body, key);
    expect(r2.body.number).toBe(r1.body.number);
    const orders = await prisma.order.findMany({ where: { contactPhone: body.phone } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ source: 'phone', status: 'NEW', paymentMethod: 'COD' });
    const [created] = await events(orders[0]!.id, 'CREATED');
    expect(created).toMatchObject({ actorType: 'STAFF', actorId: as.OPERATOR.id });
    expect(await prisma.reservation.count({ where: { orderId: orders[0]!.id } })).toBe(1);
    expect(await audits(orders[0]!.id, 'order.manual_created')).toHaveLength(2);
    const noKey = await post('OPERATOR', '/v1/admin/orders', body);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const bad = await postKeyed(
      'OPERATOR',
      '/v1/admin/orders',
      { ...body, lines: [{ variantId: 'nope', qty: 1 }] },
      `mo-${run}-${randomBytes(6).toString('hex')}`,
    );
    expect(bad.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('CSV export: masked phones unless customers.export; audited', async () => {
    const filter = { q: runQuery, tab: 'all' };
    const since = new Date();
    const owner = await post('OWNER', '/v1/admin/orders/export', filter);
    expect(owner.status).toBe(200);
    expect(owner.headers['content-type']).toContain('text/csv');
    const ownerCsv = owner.text;
    expect(ownerCsv).toMatch(new RegExp(`\\+99893${run}\\d{3}`));
    expect(ownerCsv).toContain('Manzil');
    const mgr = await post('MANAGER', '/v1/admin/orders/export', filter);
    expect(mgr.text).not.toMatch(new RegExp(`\\+99893${run}\\d{3}`));
    expect(mgr.text).toContain('+998 93 *** **');
    expect(mgr.text).not.toContain('12-uy');
    const logs = await prisma.auditLog.findMany({
      where: {
        action: 'order.export',
        staffId: { in: [as.OWNER.id, as.MANAGER.id] },
        createdAt: { gte: since },
      },
    });
    expect(logs).toHaveLength(2);
  });
});
