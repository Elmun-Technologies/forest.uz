import { createHash } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { fiscalEvidence } from '../src/commerce/fiscal.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import {
  CLICK_FISCALIZE,
  ClickFiscalService,
  PAYMENTS_QUEUE,
} from '../src/payments/click-fiscal.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp, nextTestIp, shopper } from './app';
import { ClickMerchantStub } from './click-merchant-stub';

/**
 * Click fiscalization against a local Merchant API stub: paid Click order → submit_items with the
 * order lines + delivery → receipt link stored as the payment's fiscal evidence; failures back off,
 * missing data is reported instead of sending an incomplete receipt, nothing is filed twice.
 */
describe('Click fiscalization (Merchant API ofd_data)', () => {
  const SECRET = 'click-secret-Fq12';
  const stub = new ClickMerchantStub('3333', SECRET);
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fiscal: ClickFiscalService;
  let settings: SettingsService;
  let storeInfo: Awaited<ReturnType<SettingsService['get']>>;
  let ownerId: string;
  let seq = 8_100_000;
  let phoneSeq = 0;
  const IKPU = '03208001001000000';
  const PACKAGE = '1501498';

  beforeAll(async () => {
    await stub.start();
    app = await createTestApp({ PROVIDERS_MODE: 'sandbox', CLICK_MERCHANT_API_URL: stub.url });
    prisma = app.get(PrismaService);
    fiscal = app.get(ClickFiscalService);
    settings = app.get(SettingsService);
    // The test drives the job by hand.
    await app.get<Queue>(getQueueToken(PAYMENTS_QUEUE)).removeJobScheduler(CLICK_FISCALIZE);
    ownerId = (
      await prisma.staff.create({
        data: { email: `cf-owner-${Date.now()}@t.uz`, name: 'O', role: 'OWNER', passwordHash: 'x' },
      })
    ).id;
    await app.get(IntegrationsService).connect(
      'click',
      {
        serviceId: '2222',
        merchantId: '1111',
        merchantUserId: '3333',
        secretKey: SECRET,
        mode: 'test',
        shippingIkpu: '10112001001000000',
        shippingPackageCode: '1545437',
      },
      ownerId,
      null,
    );
    await prisma.variant.update({
      where: { sku: 'FR-RL-10' },
      data: { ikpu: IKPU, packageCode: PACKAGE },
    });
    const store = await settings.get('store.info');
    storeInfo = store;
    await settings.set('store.info', { ...store, legal: { ...store.legal, stir: '301234567' } });
  });

  afterAll(async () => {
    await settings.set('store.info', storeInfo as never);
    await prisma.variant.update({
      where: { sku: 'FR-RL-10' },
      data: { ikpu: '00000000000000000', packageCode: null },
    });
    await prisma.integration.updateMany({
      where: { key: 'click' },
      data: { status: 'DISCONNECTED', credentials: null },
    });
    await app.close();
    await stub.stop();
  });

  async function paidClickOrder() {
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty: 2 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', nextTestIp())
      .set('Idempotency-Key', `cf-${Date.now()}-${++phoneSeq}-abcdefgh`)
      .send({
        name: 'Malika',
        phone: `+9989033${String(phoneSeq).padStart(5, '0')}`,
        region: 'tashkent_city',
        addressLine: 'Yunusobod 4-kvartal, 12-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'CLICK',
        offerVersion: 'v1',
      })
      .expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
    const f: Record<string, string> = {
      click_trans_id: String(++seq),
      service_id: '2222',
      click_paydoc_id: String(seq + 1_000_000),
      merchant_trans_id: o.number,
      amount: `${Number(o.totalTiyin) / 100}.00`,
      action: '0',
      error: '0',
      error_note: 'Success',
      sign_time: '2026-11-12 10:04:05',
    };
    const sign = (x: Record<string, string>) =>
      createHash('md5')
        .update(
          x.click_trans_id! +
            x.service_id! +
            SECRET +
            x.merchant_trans_id! +
            (x.action === '1' ? x.merchant_prepare_id! : '') +
            x.amount! +
            x.action! +
            x.sign_time!,
        )
        .digest('hex');
    const post = (path: string, body: Record<string, string>) =>
      request(app.getHttpServer())
        .post(`/v1/webhooks/click/${path}`)
        .type('form')
        .send({ ...body, sign_string: sign(body) })
        .expect(200);
    const prep = await post('prepare', f);
    const done = {
      ...f,
      action: '1',
      merchant_prepare_id: String(prep.body.merchant_prepare_id),
    };
    expect((await post('complete', done)).body.error).toBe(0);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: o.id, status: 'PAID' },
    });
    return { order: o, payment, paydocId: f.click_paydoc_id! };
  }

  const payment = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const ofd = async (id: string) =>
    ((await payment(id)).providerData as { ofd?: Record<string, unknown> }).ofd;

  it('submits the order lines + delivery, then stores the receipt link as fiscal evidence', async () => {
    const { order, payment: p, paydocId } = await paidClickOrder();
    const now = Date.now();
    stub.calls.length = 0;
    await fiscal.fiscalizeDue(now);

    // Other suites' paid Click orders in the shared DB may be fiscalized in the same run.
    const mine = (c: (typeof stub.calls)[number]) =>
      c.method === 'POST' && (c.body as { payment_id?: number }).payment_id === Number(paydocId);
    const submit = stub.calls.find(mine);
    expect(submit?.path).toBe('/payment/ofd_data/submit_items');
    const body = submit!.body as {
      service_id: number;
      payment_id: number;
      items: Record<string, unknown>[];
      received_card: number;
    };
    expect(body).toMatchObject({ service_id: 2222, payment_id: Number(paydocId) });
    expect(body.received_card).toBe(Number(order.totalTiyin));
    expect(body.items[0]).toMatchObject({
      SPIC: IKPU,
      PackageCode: PACKAGE,
      Amount: 2,
      VATPercent: 12,
      CommissionInfo: { TIN: '301234567' },
    });
    expect(body.items.at(-1)).toMatchObject({ SPIC: '10112001001000000', Amount: 1 });
    expect(await ofd(p.id)).toMatchObject({ state: 'submitted', attempts: 1 });
    expect((await payment(p.id)).fiscalReceiptUrl).toBeNull();

    // Next run picks the link up (no second submission).
    await fiscal.fiscalizeDue(now + 60_000);
    const after = await payment(p.id);
    expect(after.fiscalReceiptUrl).toMatch(/^https:\/\/ofd\.soliq\.uz\//);
    expect(await ofd(p.id)).toMatchObject({ state: 'done' });
    expect(stub.calls.filter(mine)).toHaveLength(1);
    expect(await prisma.$transaction((tx) => fiscalEvidence(tx, order.id))).toBe('payment_url');
  });

  it('backs off after a Click error and retries later; never files a receipt twice', async () => {
    const { payment: p, paydocId } = await paidClickOrder();
    const now = Date.now() + 2 * 60_000;
    stub.submitFaults.push({ error_code: -5, error_note: 'Temporary error' });
    await fiscal.fiscalizeDue(now);
    const failed = await ofd(p.id);
    expect(failed).toMatchObject({ state: 'pending', attempts: 1 });
    expect(String(failed!.reason)).toContain('error_code -5');
    expect(Number(failed!.nextAt)).toBeGreaterThan(now);
    const log = await prisma.integrationLog.findFirst({
      where: { integrationKey: 'click', kind: 'fiscal.submit_items', ok: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.message).toContain('error_code -5');

    // Not due yet → untouched.
    await fiscal.fiscalizeDue(now + 1000);
    expect(await ofd(p.id)).toMatchObject({ attempts: 1 });

    // A receipt registered meanwhile (e.g. a crash after a submission) is taken as is.
    stub.receipts.set(paydocId, `https://ofd.soliq.uz/check?t=PRE${paydocId}`);
    const posts = stub.calls.filter((c) => c.method === 'POST').length;
    await fiscal.fiscalizeDue(now + 10 * 60_000);
    expect((await payment(p.id)).fiscalReceiptUrl).toContain(`PRE${paydocId}`);
    expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(posts);
  });

  it('reports missing seller TIN instead of sending an incomplete receipt', async () => {
    const store = await settings.get('store.info');
    await settings.set('store.info', { ...store, legal: { ...store.legal, stir: null } });
    try {
      const { payment: p } = await paidClickOrder();
      const posts = stub.calls.filter((c) => c.method === 'POST').length;
      await fiscal.fiscalizeDue(Date.now() + 30 * 60_000);
      expect(await ofd(p.id)).toMatchObject({
        state: 'pending',
        attempts: 0,
        reason: 'seller TIN/PINFL missing (store legal data)',
      });
      expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(posts);
    } finally {
      await settings.set('store.info', store);
    }
  });
});
