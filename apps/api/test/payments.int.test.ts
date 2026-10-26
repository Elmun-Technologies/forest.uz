import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

/**
 * Contract tests for the Payme Merchant API and the Click SHOP API against the real HTTP
 * pipeline, with connected integrations (encrypted test credentials) in sandbox mode.
 */
describe('payments: Payme Merchant API + Click SHOP API (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let lifecycle: OrderLifecycleService;
  let ownerId: string;
  const startedAt = new Date();
  const H = 3600_000;

  let paymeKey = 'payme-test-key-7Hq2';
  const CLICK_SECRET = 'click-secret-Zx91';
  let rpcSeq = 0;
  let phoneSeq = 0;
  let txnSeq = 0;
  let clickSeq = 7_000_000;

  const txnId = () => `65f0${Date.now().toString(16)}${(++txnSeq).toString(16).padStart(4, '0')}`;
  const basic = (key: string) => `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`;

  async function rpc(
    method: string,
    params: Record<string, unknown>,
    auth: string | null = basic(paymeKey),
  ) {
    const id = ++rpcSeq;
    const req = request(app.getHttpServer()).post('/v1/webhooks/payme');
    if (auth) req.set('Authorization', auth);
    const res = await req.send({ jsonrpc: '2.0', id, method, params });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    return res.body as {
      result: Record<string, unknown> | null;
      error: {
        code: number;
        message: { ru: string; uz: string; en: string };
        data?: string;
      } | null;
    };
  }

  async function placeOrder(method: 'PAYME' | 'CLICK' | 'COD', sku = 'FR-RL-10') {
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku } })).id;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `pay-${Date.now()}-${++phoneSeq}-abcdefgh`)
      .send({
        name: 'Malika',
        phone: `+9989022${String(phoneSeq).padStart(5, '0')}`,
        region: 'tashkent_city',
        addressLine: 'Yunusobod 4-kvartal, 12-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: method,
        offerVersion: 'v1',
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: res.body.publicId },
      include: { items: true },
    });
    return { ...order, next: res.body.next as { type: string; url?: string } };
  }

  const amount = (o: { totalTiyin: bigint }) => Number(o.totalTiyin);
  const account = (o: { number: string }) => ({ order_id: o.number });

  async function createTxn(
    o: { number: string; totalTiyin: bigint },
    id = txnId(),
    time = Date.now(),
  ) {
    const r = await rpc('CreateTransaction', { id, time, amount: amount(o), account: account(o) });
    expect(r.error).toBeNull();
    return { id, result: r.result! };
  }

  const paymentByTxn = (method: 'PAYME' | 'CLICK', providerTxnId: string) =>
    prisma.payment.findUniqueOrThrow({
      where: { method_providerTxnId: { method, providerTxnId } },
      include: { refunds: true, order: { include: { events: true, reservations: true } } },
    });

  beforeAll(async () => {
    app = await createTestApp({ PROVIDERS_MODE: 'sandbox' });
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    lifecycle = app.get(OrderLifecycleService);
    ownerId = (
      await prisma.staff.create({
        data: {
          email: `pay-owner-${Date.now()}@t.uz`,
          name: 'O',
          role: 'OWNER',
          passwordHash: 'x',
        },
      })
    ).id;
    await integrations.connect(
      'payme',
      {
        merchantId: '587f72c72cac0d162c722ae2',
        key: 'payme-live-key-NOT-USED',
        testKey: paymeKey,
        mode: 'test',
        fiscalDetail: 'on',
        allowedIps: '127.0.0.1, ::1',
      },
      ownerId,
      null,
    );
    await integrations.connect(
      'click',
      {
        serviceId: '2222',
        merchantId: '1111',
        merchantUserId: '3333',
        secretKey: CLICK_SECRET,
        mode: 'test',
      },
      ownerId,
      null,
    );
  });

  afterAll(async () => {
    // Leave no connected test integrations / audit rows behind for other suites.
    await prisma.integration.updateMany({
      where: { key: { in: ['payme', 'click'] } },
      data: { status: 'DISCONNECTED', credentials: null },
    });
    await prisma.auditLog.deleteMany({
      where: { entity: 'Integration', createdAt: { gte: startedAt } },
    });
    await app.close();
  });

  // ───────────── Payme ─────────────

  describe('Payme', () => {
    it('stores credentials encrypted and hands out real checkout links in sandbox', async () => {
      const row = await prisma.integration.findUniqueOrThrow({ where: { key: 'payme' } });
      expect(row.status).toBe('CONNECTED');
      expect(Buffer.from(row.credentials!).toString('utf8')).not.toContain(paymeKey);

      const order = await placeOrder('PAYME');
      expect(order.next.type).toBe('redirect');
      const url = new URL(order.next.url!);
      expect(url.origin).toBe('https://test.paycom.uz');
      const decoded = Buffer.from(url.pathname.slice(1), 'base64').toString('utf8');
      expect(decoded).toMatch(
        new RegExp(
          `^m=587f72c72cac0d162c722ae2;ac\\.order_id=${order.number};a=${order.totalTiyin};` +
            `c=https?://[^;]+/uz/buyurtma/${order.publicId};l=uz$`,
        ),
      );

      const click = await placeOrder('CLICK');
      const curl = new URL(click.next.url!);
      expect(curl.origin + curl.pathname).toBe('https://my.click.uz/services/pay');
      expect(curl.searchParams.get('transaction_param')).toBe(click.number);
      expect(curl.searchParams.get('amount')).toBe(String(Number(click.totalTiyin) / 100));
    });

    it('rejects bad auth with -32504 (missing, wrong key, live key in test mode, foreign IP)', async () => {
      const o = await placeOrder('PAYME');
      const params = { amount: amount(o), account: account(o) };
      for (const auth of [null, basic('wrong'), basic('payme-live-key-NOT-USED'), 'Bearer x']) {
        const r = await rpc('CheckPerformTransaction', params, auth);
        expect(r.error).toMatchObject({ code: -32504 });
        expect(r.error!.message).toEqual({
          ru: expect.any(String),
          uz: expect.any(String),
          en: 'Insufficient privilege to perform this method.',
        });
        expect(r.result).toBeNull();
      }
      await integrations.connect('payme', { allowedIps: '10.9.9.9' }, ownerId, null);
      expect((await rpc('CheckPerformTransaction', params)).error?.code).toBe(-32504);
      await integrations.connect('payme', { allowedIps: '127.0.0.1, ::1' }, ownerId, null);
      expect((await rpc('CheckPerformTransaction', params)).error).toBeNull();
    });

    it('answers protocol errors: unknown method -32601, malformed params -32600, bad JSON -32700', async () => {
      const unknown = await rpc('GetMoney', {});
      expect(unknown.error).toMatchObject({ code: -32601, data: 'GetMoney' });
      const noId = await rpc('PerformTransaction', {});
      expect(noId.error).toMatchObject({ code: -32600, data: 'id' });
      const bad = await request(app.getHttpServer())
        .post('/v1/webhooks/payme')
        .set('Authorization', basic(paymeKey))
        .set('Content-Type', 'application/json')
        .send('{"id": 1, "method": ')
        .expect(200);
      expect(bad.body).toMatchObject({ result: null, error: { code: -32700 } });
      // Elsewhere a malformed body is a plain 400, not a 500.
      const other = await request(app.getHttpServer())
        .post('/v1/cart/items')
        .set('Content-Type', 'application/json')
        .send('{"variantId": ')
        .expect(400);
      expect(other.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('CheckPerformTransaction: allow + fiscal detail; -31001 amount; -31050 account', async () => {
      const o = await placeOrder('PAYME');
      const ok = await rpc('CheckPerformTransaction', { amount: amount(o), account: account(o) });
      expect(ok.error).toBeNull();
      const item = o.items[0]!;
      expect(ok.result).toEqual({
        allow: true,
        detail: {
          receipt_type: 0,
          items: [
            {
              title: expect.any(String),
              price: Number(item.priceTiyin),
              count: 1,
              code: item.ikpu,
              package_code: item.packageCode,
              vat_percent: item.vatPercent,
              discount: 0,
            },
          ],
          shipping: { title: 'Yetkazib berish', price: Number(o.shippingTiyin) },
        },
      });
      expect(o.shippingTiyin).toBeGreaterThan(0n);

      const wrong = await rpc('CheckPerformTransaction', {
        amount: amount(o) + 100,
        account: account(o),
      });
      expect(wrong.error).toMatchObject({ code: -31001 });
      const fractional = await rpc('CheckPerformTransaction', { amount: 1.5, account: account(o) });
      expect(fractional.error).toMatchObject({ code: -31001 });

      for (const acc of [{ order_id: 'F-999999999' }, {}, { phone: '901234567' }]) {
        const r = await rpc('CheckPerformTransaction', { amount: amount(o), account: acc });
        expect(r.error).toMatchObject({
          code: -31050,
          data: 'order_id',
          message: {
            ru: 'Неверный код заказа.',
            uz: 'Harid kodida xatolik.',
            en: 'Incorrect order code.',
          },
        });
      }
      const cod = await placeOrder('COD');
      const codRes = await rpc('CheckPerformTransaction', {
        amount: amount(cod),
        account: account(cod),
      });
      expect(codRes.error).toMatchObject({ code: -31050 });

      await integrations.connect('payme', { fiscalDetail: 'off' }, ownerId, null);
      const plain = await rpc('CheckPerformTransaction', {
        amount: amount(o),
        account: account(o),
      });
      expect(plain.result).toEqual({ allow: true });
      await integrations.connect('payme', { fiscalDetail: 'on' }, ownerId, null);
    });

    it('full flow: create (idempotent) → perform (idempotent) → paid order; repeats never double-pay', async () => {
      const o = await placeOrder('PAYME');
      const { id, result: created } = await createTxn(o);
      expect(created).toEqual({
        create_time: expect.any(Number),
        transaction: expect.any(String),
        state: 1,
        receivers: null,
      });
      const again = await rpc('CreateTransaction', {
        id,
        time: Date.now(),
        amount: amount(o),
        account: account(o),
      });
      expect(again.result).toEqual(created);

      // Another transaction for the same order while one is active.
      const blocked = await rpc('CheckPerformTransaction', {
        amount: amount(o),
        account: account(o),
      });
      expect(blocked.error).toMatchObject({ code: -31008 });
      const other = await rpc('CreateTransaction', {
        id: txnId(),
        time: Date.now(),
        amount: amount(o),
        account: account(o),
      });
      expect(other.error).toMatchObject({ code: -31050 });

      const check1 = await rpc('CheckTransaction', { id });
      expect(check1.result).toEqual({
        create_time: created.create_time,
        perform_time: 0,
        cancel_time: 0,
        transaction: created.transaction,
        state: 1,
        reason: null,
      });

      const performed = await rpc('PerformTransaction', { id });
      expect(performed.result).toEqual({
        transaction: created.transaction,
        perform_time: expect.any(Number),
        state: 2,
      });
      const repeat = await rpc('PerformTransaction', { id });
      expect(repeat.result).toEqual(performed.result);

      const p = await paymentByTxn('PAYME', id);
      expect(p.id).toBe(created.transaction);
      expect(p.status).toBe('PAID');
      expect(p.providerState).toBe(2);
      expect(p.order.status).toBe('CONFIRMED');
      expect(p.order.slaDueAt).not.toBeNull();
      expect(p.order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
      expect(p.order.reservations.every((r) => r.expiresAt === null)).toBe(true);

      const check2 = await rpc('CheckTransaction', { id });
      expect(check2.result).toMatchObject({
        state: 2,
        perform_time: performed.result!.perform_time,
      });
      // Paid order: no new transaction, no new check.
      const paidCheck = await rpc('CheckPerformTransaction', {
        amount: amount(o),
        account: account(o),
      });
      expect(paidCheck.error).toMatchObject({ code: -31008 });
      const paidCreate = await rpc('CreateTransaction', {
        id: txnId(),
        time: Date.now(),
        amount: amount(o),
        account: account(o),
      });
      expect(paidCreate.error).toMatchObject({ code: -31008 });
      // Re-sending the original create for a performed transaction is not active any more.
      expect(
        (
          await rpc('CreateTransaction', {
            id,
            time: Date.now(),
            amount: amount(o),
            account: account(o),
          })
        ).error,
      ).toMatchObject({ code: -31008 });
    });

    it('cancel before perform (-1): payment FAILED, order stays payable, idempotent; new txn gets its own row', async () => {
      const o = await placeOrder('PAYME');
      const { id, result: created } = await createTxn(o);
      const cancelled = await rpc('CancelTransaction', { id, reason: 3 });
      expect(cancelled.result).toEqual({
        transaction: created.transaction,
        cancel_time: expect.any(Number),
        state: -1,
      });
      const again = await rpc('CancelTransaction', { id, reason: 3 });
      expect(again.result).toEqual(cancelled.result);
      expect((await rpc('PerformTransaction', { id })).error).toMatchObject({ code: -31008 });
      expect((await rpc('CheckTransaction', { id })).result).toMatchObject({
        state: -1,
        reason: 3,
      });

      const p = await paymentByTxn('PAYME', id);
      expect(p.status).toBe('FAILED');
      expect(p.order.status).toBe('NEW');

      const second = await createTxn(o);
      expect(second.result.transaction).not.toBe(created.transaction);
      expect((await rpc('PerformTransaction', { id: second.id })).result).toMatchObject({
        state: 2,
      });
      // The first transaction's history is intact.
      expect((await rpc('CheckTransaction', { id })).result).toMatchObject({
        transaction: created.transaction,
        state: -1,
        reason: 3,
      });
    });

    it('cancel after perform (-2) = refund: REFUNDED + Refund row, order cancelled, stock released', async () => {
      const o = await placeOrder('PAYME', 'FR-BR-40');
      const before = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-BR-40' } });
      const { id, result: created } = await createTxn(o);
      await rpc('PerformTransaction', { id });
      const res = await rpc('CancelTransaction', { id, reason: 5 });
      expect(res.result).toEqual({
        transaction: created.transaction,
        cancel_time: expect.any(Number),
        state: -2,
      });
      expect((await rpc('CancelTransaction', { id, reason: 5 })).result).toEqual(res.result);
      expect((await rpc('PerformTransaction', { id })).error).toMatchObject({ code: -31008 });
      expect((await rpc('CheckTransaction', { id })).result).toMatchObject({
        state: -2,
        reason: 5,
      });

      const p = await paymentByTxn('PAYME', id);
      expect(p.status).toBe('REFUNDED');
      expect(p.refunds).toHaveLength(1);
      expect(p.refunds[0]).toMatchObject({ amountTiyin: o.totalTiyin, staffId: 'provider:payme' });
      expect(p.order.status).toBe('CANCELLED');
      expect(p.order.cancelReason).toBe('refunded');
      const after = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-BR-40' } });
      expect(after.reserved).toBe(before.reserved - 1);
    });

    it('cannot cancel a performed transaction once the parcel is with the courier (-31007)', async () => {
      const o = await placeOrder('PAYME');
      const { id } = await createTxn(o);
      await rpc('PerformTransaction', { id });
      await prisma.order.update({ where: { id: o.id }, data: { status: 'HANDED_TO_COURIER' } });
      const res = await rpc('CancelTransaction', { id, reason: 5 });
      expect(res.error).toMatchObject({ code: -31007 });
      expect((await paymentByTxn('PAYME', id)).status).toBe('PAID');
      expect((await rpc('CheckTransaction', { id })).result).toMatchObject({ state: 2 });
    });

    it('times out created transactions after 12 h: cancel with reason 4, then -31008', async () => {
      const o = await placeOrder('PAYME');
      const { id } = await createTxn(o);
      const p = await paymentByTxn('PAYME', id);
      const data = p.providerData as { time: number; createTime: number };
      await prisma.payment.update({
        where: { id: p.id },
        data: { providerData: { ...data, createTime: data.createTime - 12 * H - 1000 } },
      });
      const perform = await rpc('PerformTransaction', { id });
      expect(perform.error).toMatchObject({
        code: -31008,
        message: { en: 'Transaction is expired.' },
      });
      expect((await rpc('CheckTransaction', { id })).result).toMatchObject({
        state: -1,
        reason: 4,
      });
      expect((await paymentByTxn('PAYME', id)).status).toBe('FAILED');

      // Same on a repeated CreateTransaction of an expired transaction.
      const o2 = await placeOrder('PAYME');
      const t2 = await createTxn(o2);
      const p2 = await paymentByTxn('PAYME', t2.id);
      const d2 = p2.providerData as { time: number; createTime: number };
      await prisma.payment.update({
        where: { id: p2.id },
        data: { providerData: { ...d2, createTime: d2.createTime - 13 * H } },
      });
      const recreate = await rpc('CreateTransaction', {
        id: t2.id,
        time: d2.time,
        amount: amount(o2),
        account: account(o2),
      });
      expect(recreate.error).toMatchObject({ code: -31008 });
      expect((await rpc('CheckTransaction', { id: t2.id })).result).toMatchObject({
        state: -1,
        reason: 4,
      });

      // A brand-new transaction whose Payme time is already older than the timeout.
      const stale = await rpc('CreateTransaction', {
        id: txnId(),
        time: Date.now() - 12 * H - 1000,
        amount: amount(o2),
        account: account(o2),
      });
      expect(stale.error).toMatchObject({ code: -31050, data: 'time' });
    });

    it('refuses orders whose payment window is over (-31008) and unknown transactions (-31003)', async () => {
      const o = await placeOrder('PAYME');
      await prisma.reservation.updateMany({
        where: { orderId: o.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const r = await rpc('CheckPerformTransaction', { amount: amount(o), account: account(o) });
      expect(r.error).toMatchObject({ code: -31008 });
      for (const method of ['PerformTransaction', 'CheckTransaction']) {
        expect((await rpc(method, { id: 'no-such-txn' })).error).toMatchObject({ code: -31003 });
      }
      expect(
        (await rpc('CancelTransaction', { id: 'no-such-txn', reason: 1 })).error,
      ).toMatchObject({
        code: -31003,
      });
    });

    it('concurrent PerformTransaction / CreateTransaction calls pay and create exactly once', async () => {
      const o = await placeOrder('PAYME');
      const id = txnId();
      const time = Date.now();
      const creates = await Promise.all(
        Array.from({ length: 4 }, () =>
          rpc('CreateTransaction', { id, time, amount: amount(o), account: account(o) }),
        ),
      );
      expect(creates.every((c) => c.error === null)).toBe(true);
      expect(new Set(creates.map((c) => c.result!.transaction)).size).toBe(1);

      const performs = await Promise.all(
        Array.from({ length: 6 }, () => rpc('PerformTransaction', { id })),
      );
      expect(performs.every((x) => x.error === null && x.result!.state === 2)).toBe(true);
      expect(new Set(performs.map((x) => x.result!.perform_time)).size).toBe(1);
      const p = await paymentByTxn('PAYME', id);
      expect(p.order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
      expect(p.order.events.filter((e) => e.to === 'CONFIRMED')).toHaveLength(1);
      expect(await prisma.payment.count({ where: { orderId: o.id, status: 'PAID' } })).toBe(1);
    });

    it('GetStatement lists transactions by Payme time (boundaries included) and validates the period', async () => {
      const base = Date.now() - 5 * H;
      const o1 = await placeOrder('PAYME');
      const o2 = await placeOrder('PAYME');
      const t1 = await createTxn(o1, txnId(), base);
      const t2 = await createTxn(o2, txnId(), base + 1000);
      await rpc('PerformTransaction', { id: t2.id });

      const res = await rpc('GetStatement', { from: base, to: base + 1000 });
      const mine = (res.result!.transactions as Record<string, unknown>[]).filter((x) =>
        [t1.id, t2.id].includes(x.id as string),
      );
      expect(mine).toEqual([
        {
          id: t1.id,
          time: base,
          amount: amount(o1),
          account: { order_id: o1.number },
          create_time: t1.result.create_time,
          perform_time: 0,
          cancel_time: 0,
          transaction: t1.result.transaction,
          state: 1,
          reason: null,
          receivers: null,
        },
        expect.objectContaining({
          id: t2.id,
          time: base + 1000,
          state: 2,
          account: { order_id: o2.number },
        }),
      ]);
      const narrow = await rpc('GetStatement', { from: base + 1, to: base + 1000 });
      expect((narrow.result!.transactions as { id: string }[]).map((x) => x.id)).not.toContain(
        t1.id,
      );

      expect((await rpc('GetStatement', { from: base, to: base })).error).toMatchObject({
        code: -31050,
        data: 'from',
      });
      expect((await rpc('GetStatement', { to: base })).error).toMatchObject({
        code: -31050,
        data: 'from',
      });
      expect((await rpc('GetStatement', { from: base })).error).toMatchObject({
        code: -31050,
        data: 'to',
      });
    });

    it('ChangePassword rotates the encrypted key (audited); old key stops working', async () => {
      expect((await rpc('ChangePassword', {})).error).toMatchObject({
        code: -31050,
        data: 'password',
      });
      expect((await rpc('ChangePassword', { password: paymeKey })).error).toMatchObject({
        code: -32504,
      });
      const next = 'payme-rotated-key-Pq8x';
      expect((await rpc('ChangePassword', { password: next })).result).toEqual({ success: true });
      const oldKey = paymeKey;
      paymeKey = next;
      expect((await rpc('CheckTransaction', { id: 'x' }, basic(oldKey))).error?.code).toBe(-32504);
      expect((await rpc('CheckTransaction', { id: 'x' })).error?.code).toBe(-31003);
      expect(await integrations.credentials('payme')).toMatchObject({
        testKey: next,
        key: 'payme-live-key-NOT-USED',
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'integration.secret_rotated', entityId: 'payme' },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit)).not.toContain(next);
      const logs = await prisma.integrationLog.findMany({
        where: { integrationKey: 'payme', kind: 'webhook.ChangePassword' },
      });
      expect(JSON.stringify(logs)).not.toContain(next);
    });

    it('Payme refunds cannot be recorded manually (they come from the Payme cabinet)', async () => {
      const o = await placeOrder('PAYME');
      const { id } = await createTxn(o);
      await rpc('PerformTransaction', { id });
      const p = await paymentByTxn('PAYME', id);
      await expect(
        lifecycle.recordManualRefund(p.id, { amountTiyin: 100n, reason: 'x', staffId: ownerId }),
      ).rejects.toMatchObject({ code: 'REFUND_VIA_PROVIDER_CABINET' });
    });
  });

  // ───────────── Click ─────────────

  describe('Click', () => {
    function signed(fields: Record<string, string>, secret = CLICK_SECRET): Record<string, string> {
      const sign = createHash('md5')
        .update(
          fields.click_trans_id! +
            fields.service_id! +
            secret +
            fields.merchant_trans_id! +
            (fields.action === '1' ? fields.merchant_prepare_id! : '') +
            fields.amount! +
            fields.action! +
            fields.sign_time!,
        )
        .digest('hex');
      return { ...fields, sign_string: sign };
    }

    function fields(
      o: { number: string; totalTiyin: bigint },
      over: Record<string, string> = {},
    ): Record<string, string> {
      return {
        click_trans_id: String(++clickSeq),
        service_id: '2222',
        click_paydoc_id: String(clickSeq + 1_000_000),
        merchant_trans_id: o.number,
        amount: `${Number(o.totalTiyin) / 100}.00`,
        action: '0',
        error: '0',
        error_note: 'Success',
        sign_time: '2026-10-26 15:04:05',
        ...over,
      };
    }

    const post = async (path: 'prepare' | 'complete', body: Record<string, string>) => {
      const res = await request(app.getHttpServer())
        .post(`/v1/webhooks/click/${path}`)
        .type('form')
        .send(body)
        .expect(200);
      return res.body as Record<string, unknown>;
    };
    const prepare = (b: Record<string, string>) => post('prepare', signed(b));
    const complete = (b: Record<string, string>, prepareId: number | string) =>
      post('complete', signed({ ...b, action: '1', merchant_prepare_id: String(prepareId) }));
    const digits = (n: string) => Number(n.slice(2));

    it('valid flow: prepare → complete → order paid; repeated complete answers -4 without effects', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      const prep = await prepare(f);
      expect(prep).toEqual({
        click_trans_id: Number(f.click_trans_id),
        merchant_trans_id: o.number,
        merchant_prepare_id: digits(o.number),
        merchant_confirm_id: digits(o.number),
        error: 0,
        error_note: 'Success',
      });
      // Repeated prepare is answered again, no second row.
      expect((await prepare(f)).error).toBe(0);
      expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);

      const done = await complete(f, prep.merchant_prepare_id as number);
      expect(done).toMatchObject({ error: 0, merchant_confirm_id: digits(o.number) });
      const p = await paymentByTxn('CLICK', f.click_trans_id!);
      expect(p).toMatchObject({ status: 'PAID', providerState: 1 });
      expect(p.order.status).toBe('CONFIRMED');

      const repeat = await complete(f, prep.merchant_prepare_id as number);
      expect(repeat).toMatchObject({ error: -4, error_note: 'Already paid' });
      const after = await paymentByTxn('CLICK', f.click_trans_id!);
      expect(after.order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
      // Prepare on a paid order.
      expect((await prepare(fields(o))).error).toBe(-4);
    });

    it('bad sign -1, missing field -8, wrong action -3 (nothing written)', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      expect(await post('prepare', signed(f, 'wrong-secret'))).toMatchObject({
        error: -1,
        error_note: 'SIGN CHECK FAILED!',
      });
      expect(await post('prepare', { ...signed(f), amount: '1.00' })).toMatchObject({ error: -1 });
      const { sign_time: _drop, ...partial } = signed(f);
      expect(await post('prepare', partial)).toMatchObject({
        error: -8,
        error_note: 'Error in request from click',
      });
      expect(
        await post('prepare', signed({ ...f, action: '1', merchant_prepare_id: '1' })),
      ).toMatchObject({
        error: -3,
      });
      expect(await post('prepare', signed({ ...f, action: '7' }))).toMatchObject({ error: -3 });
      expect(await post('complete', signed({ ...f, action: '0' }))).toMatchObject({ error: -3 });
      expect(await post('complete', signed({ ...f, action: '1' }))).toMatchObject({ error: -8 });
      expect(
        await prisma.payment.count({ where: { orderId: o.id, providerTxnId: { not: null } } }),
      ).toBe(0);
    });

    it('wrong amount -2, unknown order -5, non-Click order -5', async () => {
      const o = await placeOrder('CLICK');
      expect(await prepare(fields(o, { amount: '1000.00' }))).toMatchObject({
        error: -2,
        error_note: 'Incorrect parameter amount',
      });
      expect(await prepare(fields(o, { merchant_trans_id: 'F-999999999' }))).toMatchObject({
        error: -5,
        error_note: 'User does not exist',
      });
      const payme = await placeOrder('PAYME');
      expect(await prepare(fields(payme))).toMatchObject({ error: -5 });
      // so'm without decimals is the same amount.
      expect((await prepare(fields(o, { amount: String(Number(o.totalTiyin) / 100) }))).error).toBe(
        0,
      );
    });

    it('complete without prepare / with a wrong prepare id → -6', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      expect(await complete(f, digits(o.number))).toMatchObject({
        error: -6,
        error_note: 'Transaction does not exist',
      });
      await prepare(f);
      expect(await complete(f, 123)).toMatchObject({ error: -6 });
      expect((await complete(f, digits(o.number))).error).toBe(0);
    });

    it('cancelled order -9; Click-side failure on complete → attempt rejected, -9', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      await prepare(f);
      const failed = await complete(
        { ...f, error: '-5017', error_note: 'Insufficient funds' },
        digits(o.number),
      );
      expect(failed).toMatchObject({ error: -9, error_note: 'Transaction cancelled' });
      const p = await paymentByTxn('CLICK', f.click_trans_id!);
      expect(p).toMatchObject({ status: 'FAILED', providerState: -1 });
      expect(p.order.status).toBe('NEW');
      expect((await complete(f, digits(o.number))).error).toBe(-9);
      // A new Click attempt for the same order is possible while the reservation lives.
      const f2 = fields(o);
      expect((await prepare(f2)).error).toBe(0);
      expect((await complete(f2, digits(o.number))).error).toBe(0);

      const gone = await placeOrder('CLICK');
      const g = fields(gone);
      await prepare(g);
      await prisma.reservation.updateMany({
        where: { orderId: gone.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await lifecycle.expireStale();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe(
        'CANCELLED',
      );
      expect(await complete(g, digits(gone.number))).toMatchObject({ error: -9 });
      expect(await prepare(fields(gone))).toMatchObject({ error: -9 });
    });

    it('concurrent completes pay exactly once', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      await prepare(f);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => complete(f, digits(o.number))),
      );
      expect(results.filter((r) => r.error === 0)).toHaveLength(1);
      expect(results.filter((r) => r.error === -4)).toHaveLength(4);
      const p = await paymentByTxn('CLICK', f.click_trans_id!);
      expect(p.order.events.filter((e) => e.type === 'PAYMENT_PAID')).toHaveLength(1);
    });

    it('manual refunds: partial → PARTIALLY_REFUNDED, rest → REFUNDED + order cancelled; bad amounts refused', async () => {
      const o = await placeOrder('CLICK');
      const f = fields(o);
      await prepare(f);
      await complete(f, digits(o.number));
      const p = await paymentByTxn('CLICK', f.click_trans_id!);
      await expect(
        lifecycle.recordManualRefund(p.id, { amountTiyin: 0n, reason: 'x', staffId: ownerId }),
      ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
      await expect(
        lifecycle.recordManualRefund(p.id, {
          amountTiyin: o.totalTiyin + 1n,
          reason: 'x',
          staffId: ownerId,
        }),
      ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
      const part = await lifecycle.recordManualRefund(p.id, {
        amountTiyin: 1_000_000n,
        reason: 'damaged lid',
        staffId: ownerId,
      });
      expect(part.full).toBe(false);
      expect((await paymentByTxn('CLICK', f.click_trans_id!)).status).toBe('PARTIALLY_REFUNDED');
      const rest = await lifecycle.recordManualRefund(p.id, {
        amountTiyin: o.totalTiyin - 1_000_000n,
        reason: 'order cancelled',
        staffId: ownerId,
      });
      expect(rest.full).toBe(true);
      const after = await paymentByTxn('CLICK', f.click_trans_id!);
      expect(after.status).toBe('REFUNDED');
      expect(after.refunds).toHaveLength(2);
      expect(after.order.status).toBe('CANCELLED');
      await expect(
        lifecycle.recordManualRefund(p.id, { amountTiyin: 1n, reason: 'x', staffId: ownerId }),
      ).rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED' });
    });

    it('logs webhook calls to IntegrationLog without secrets', async () => {
      const logs = await prisma.integrationLog.findMany({
        where: { integrationKey: 'click', createdAt: { gte: startedAt } },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs)).not.toContain(CLICK_SECRET);
      expect(logs.some((l) => l.kind === 'webhook.complete' && l.ok)).toBe(true);
    });
  });
});
