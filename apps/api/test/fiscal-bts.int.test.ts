import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FiscalService } from '../src/commerce/fiscal.service';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { ManualShipmentService } from '../src/delivery/manual-shipment.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, shopper } from './app';

describe('BTS manual shipments + fiscal receipt rule (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let lifecycle: OrderLifecycleService;
  let shipments: ManualShipmentService;
  let fiscal: FiscalService;
  let staffId: string;
  let seq = 0;
  const base = Math.floor(Math.random() * 90_000);
  const STAFF = () => ({ type: 'STAFF' as const, id: staffId });

  async function placeOrder(
    method: 'COD' | 'PAYME' | 'CLICK',
    zoneKey = 'regions-bts',
    region = 'samarkand',
  ) {
    const phone = `+99897${String(base + ++seq).padStart(7, '0')}`;
    const variantId = (await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } })).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty: 1 }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('Idempotency-Key', `bts-${Date.now()}-${seq}-abcdefgh`)
      .send({
        name: 'Jasur Aliyev',
        phone,
        region,
        addressLine: 'Registon ko‘chasi 5-uy',
        zoneKey,
        paymentMethod: method,
        offerVersion: 'v1',
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
    return { ...order, phone };
  }

  async function confirmed(method: 'COD' | 'PAYME' | 'CLICK', zoneKey?: string, region?: string) {
    const o = await placeOrder(method, zoneKey, region);
    if (method === 'COD') await lifecycle.confirmCod(o.id, STAFF());
    else
      await request(app.getHttpServer())
        .post('/v1/dev/fake-pay')
        .send({ order: o.publicId, result: 'success' })
        .expect(201);
    return o;
  }

  const sms = (phone: string, templateKey: string) =>
    integrations.outbox.list(phone).filter((m) => m.templateKey === templateKey);
  const orderOf = (id: string) =>
    prisma.order.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } }, shipments: true },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    lifecycle = app.get(OrderLifecycleService);
    shipments = app.get(ManualShipmentService);
    fiscal = app.get(FiscalService);
    staffId = (
      await prisma.staff.create({
        data: {
          email: `bts-op-${Date.now()}@t.uz`,
          name: 'Op',
          role: 'OPERATOR',
          passwordHash: 'x',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('BTS is a manual provider outside fake mode (no API calls)', async () => {
    const { BtsManualDeliveryProvider } = await import('../src/integrations/providers/bts-manual');
    const p = new BtsManualDeliveryProvider();
    expect(await p.quote({ region: 'samarkand', line: 'x' }, 1000)).toBeNull();
    await expect(p.getState('manual:F-1')).rejects.toThrow(/manual mode/);
  });

  it('refuses unconfirmed orders, other carriers and a missing track number', async () => {
    const fresh = await placeOrder('COD');
    await expect(
      shipments.setManualShipment(
        fresh.id,
        { status: 'CREATED', trackNumber: 'BTS-100001' },
        staffId,
      ),
    ).rejects.toMatchObject({ code: 'SHIPMENT_ORDER_NOT_READY' });

    const yandex = await confirmed('COD', 'tashkent-city-yandex', 'tashkent_city');
    await expect(
      shipments.setManualShipment(yandex.id, { status: 'CREATED', trackNumber: 'BTS-1' }, staffId),
    ).rejects.toMatchObject({ code: 'SHIPMENT_CARRIER_MISMATCH' });

    await lifecycle.confirmCod(fresh.id, STAFF());
    await expect(
      shipments.setManualShipment(fresh.id, { status: 'CREATED' }, staffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'trackNumber' });
    await expect(
      shipments.setManualShipment(
        fresh.id,
        { status: 'CREATED', trackNumber: 'a b<script>' },
        staffId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'trackNumber' });
  });

  it('walks a COD order through the manual BTS statuses with events and SMS', async () => {
    const o = await confirmed('COD');
    const created = await shipments.setManualShipment(
      o.id,
      { status: 'CREATED', trackNumber: 'BTS-7712001' },
      staffId,
    );
    expect(created).toMatchObject({
      changed: true,
      orderStatus: 'CONFIRMED',
      orderSteps: [],
      notified: [],
    });

    const picked = await shipments.setManualShipment(o.id, { status: 'PICKED_UP' }, staffId);
    expect(picked).toMatchObject({
      orderStatus: 'HANDED_TO_COURIER',
      orderSteps: ['PACKING', 'READY', 'HANDED_TO_COURIER'],
      notified: ['order_shipped_bts'],
    });
    const shipped = sms(o.phone, 'order_shipped_bts');
    expect(shipped).toHaveLength(1);
    expect(shipped[0]!.text).toContain('BTS-7712001');
    expect(shipped[0]!.text).toMatch(/Kuzatish: http:\/\/\S+\/t\/\w{10}/);

    // Same status again: no-op (no event, no second SMS).
    const repeat = await shipments.setManualShipment(o.id, { status: 'PICKED_UP' }, staffId);
    expect(repeat.changed).toBe(false);
    expect(sms(o.phone, 'order_shipped_bts')).toHaveLength(1);

    await shipments.setManualShipment(
      o.id,
      { status: 'AT_BRANCH', branch: 'Samarqand, BTS 3-filial (Registon)', note: 'polka 12' },
      staffId,
    );
    expect(sms(o.phone, 'order_at_branch')[0]!.text).toContain(
      'Samarqand, BTS 3-filial (Registon)',
    );
    await expect(
      shipments.setManualShipment(o.id, { status: 'IN_TRANSIT' }, staffId),
    ).rejects.toMatchObject({ code: 'DELIVERY_INVALID_TRANSITION' });

    const delivered = await shipments.setManualShipment(o.id, { status: 'DELIVERED' }, staffId);
    expect(delivered).toMatchObject({ orderStatus: 'DELIVERED', notified: ['order_delivered'] });
    expect(sms(o.phone, 'order_delivered')).toHaveLength(1);

    const row = await orderOf(o.id);
    expect(row.status).toBe('DELIVERED');
    expect(row.shipments[0]).toMatchObject({
      status: 'DELIVERED',
      trackNumber: 'BTS-7712001',
      externalId: 'BTS-7712001',
      branch: { name: 'Samarqand, BTS 3-filial (Registon)' },
    });
    const history = row.shipments[0]!.history as {
      status: string;
      place?: string;
      note?: string;
    }[];
    expect(history.map((h) => h.status)).toEqual([
      'CREATED',
      'PICKED_UP',
      'AT_BRANCH',
      'DELIVERED',
    ]);
    expect(history[2]).toMatchObject({
      place: 'Samarqand, BTS 3-filial (Registon)',
      note: 'polka 12',
    });
    const changes = row.events.filter((e) => e.type === 'STATUS_CHANGED').map((e) => e.to);
    expect(changes).toEqual(['CONFIRMED', 'PACKING', 'READY', 'HANDED_TO_COURIER', 'DELIVERED']);
    expect(row.events.filter((e) => e.type === 'DELIVERY_STATUS')).toHaveLength(4);
    expect(
      row.events.filter((e) => e.type === 'STATUS_CHANGED' && e.to === 'PACKING')[0],
    ).toMatchObject({ actorType: 'STAFF', actorId: staffId });

    // The public tracking page shows the waybill and the manual history.
    const track = await request(app.getHttpServer())
      .get(`/v1/track/${o.trackingToken}`)
      .expect(200);
    expect(track.body).toMatchObject({ carrierRef: 'BTS-7712001', deliveryStatus: 'DELIVERED' });
    expect(track.body.history).toHaveLength(4);

    // Fiscal rule: a delivered COD order can't be closed without a receipt.
    await expect(lifecycle.completeOrder(o.id, STAFF())).rejects.toMatchObject({
      code: 'FISCAL_RECEIPT_REQUIRED',
    });
    await expect(fiscal.recordManualReceipt(o.id, {}, staffId)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      fiscal.recordManualReceipt(o.id, { receiptUrl: 'http://ofd.example/r/1' }, staffId),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'receiptUrl' });
    await fiscal.recordManualReceipt(o.id, { receiptNumber: 'FK-000123' }, staffId, '10.0.0.9');
    await fiscal.recordManualReceipt(
      o.id,
      { receiptNumber: 'FK-000124', receiptUrl: 'https://ofd.soliq.uz/check?t=abc' },
      staffId,
    );
    await lifecycle.completeOrder(o.id, STAFF());
    const done = await orderOf(o.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.events.filter((e) => e.type === 'FISCAL_RECEIPT')).toHaveLength(2);
    const receipt = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { orderId_kind: { orderId: o.id, kind: 'SALE' } },
    });
    expect(receipt).toMatchObject({
      provider: 'manual',
      receiptNumber: 'FK-000124',
      url: 'https://ofd.soliq.uz/check?t=abc',
      staffId,
    });
    const audit = await prisma.auditLog.findMany({
      where: { entity: 'Order', entityId: o.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'order.fiscal_receipt_recorded',
      'order.fiscal_receipt_corrected',
    ]);
    expect(audit[0]!.ip).toBe('10.0.0.9');
  });

  it('failed delivery → return: order RETURNED, customer told', async () => {
    const o = await confirmed('COD');
    // First entry may already be past CREATED (booked at the branch before it was entered).
    const r = await shipments.setManualShipment(
      o.id,
      { status: 'IN_TRANSIT', trackNumber: 'BTS-7712002' },
      staffId,
    );
    expect(r.orderStatus).toBe('HANDED_TO_COURIER');
    const failed = await shipments.setManualShipment(
      o.id,
      { status: 'FAILED', note: 'mijoz telefonni olmadi' },
      staffId,
    );
    expect(failed).toMatchObject({
      orderStatus: 'HANDED_TO_COURIER',
      notified: ['order_delivery_failed'],
    });
    expect(sms(o.phone, 'order_delivery_failed')[0]!.text).toContain(o.number);
    const back = await shipments.setManualShipment(o.id, { status: 'RETURNED' }, staffId);
    expect(back).toMatchObject({ orderStatus: 'RETURNED', orderSteps: ['RETURNED'] });
    await expect(
      shipments.setManualShipment(o.id, { status: 'DELIVERED' }, staffId),
    ).rejects.toMatchObject({ code: 'DELIVERY_INVALID_TRANSITION' });
    // Nothing was sold: a receipt can't close a returned order either.
    await expect(lifecycle.completeOrder(o.id, STAFF())).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
    });
  });

  it('SMS follow where the parcel is: no "shipped" for a jump to delivered/returned, "failed" once and only after hand-over', async () => {
    const open = async (id: string) =>
      (await prisma.reservation.findMany({ where: { orderId: id } })).filter((r) => !r.releasedAt)
        .length;

    // Booked, never handed over, then cancelled at BTS and the booking returned.
    const a = await confirmed('COD');
    await shipments.setManualShipment(
      a.id,
      { status: 'CREATED', trackNumber: 'BTS-7712101' },
      staffId,
    );
    const notHanded = await shipments.setManualShipment(a.id, { status: 'FAILED' }, staffId);
    expect(notHanded).toMatchObject({ orderStatus: 'CONFIRMED', notified: [] });
    const back = await shipments.setManualShipment(a.id, { status: 'RETURNED' }, staffId);
    expect(back).toMatchObject({ orderStatus: 'RETURNED', notified: [] });
    expect(sms(a.phone, 'order_shipped_bts')).toHaveLength(0);
    expect(sms(a.phone, 'order_delivery_failed')).toHaveLength(0);
    expect(await open(a.id)).toBe(0); // RETURNED frees the stock hold

    // Failed ↔ in transit bouncing: the customer is told once.
    const b = await confirmed('COD');
    await shipments.setManualShipment(
      b.id,
      { status: 'IN_TRANSIT', trackNumber: 'BTS-7712102' },
      staffId,
    );
    expect(sms(b.phone, 'order_shipped_bts')).toHaveLength(1);
    await shipments.setManualShipment(b.id, { status: 'FAILED' }, staffId);
    await shipments.setManualShipment(b.id, { status: 'IN_TRANSIT' }, staffId);
    const again = await shipments.setManualShipment(b.id, { status: 'FAILED' }, staffId);
    expect(again.notified).toEqual([]);
    expect(sms(b.phone, 'order_delivery_failed')).toHaveLength(1);
    expect(sms(b.phone, 'order_shipped_bts')).toHaveLength(1);

    // First entry already delivered: "delivered" only.
    const c = await confirmed('COD');
    const done = await shipments.setManualShipment(
      c.id,
      { status: 'DELIVERED', trackNumber: 'BTS-7712103' },
      staffId,
    );
    expect(done).toMatchObject({ orderStatus: 'DELIVERED', notified: ['order_delivered'] });
    expect(sms(c.phone, 'order_shipped_bts')).toHaveLength(0);
  });

  it('online payments: Payme with receipt detail closes; Click needs a receipt (URL or manual)', async () => {
    const deliver = async (id: string, track: string) =>
      shipments.setManualShipment(id, { status: 'DELIVERED', trackNumber: track }, staffId);

    const payme = await confirmed('PAYME');
    await deliver(payme.id, 'BTS-7712003');
    await expect(lifecycle.completeOrder(payme.id, STAFF())).rejects.toMatchObject({
      code: 'FISCAL_RECEIPT_REQUIRED',
    });
    // What Payme CreateTransaction records when the cashbox sent the receipt `detail`.
    const paid = await prisma.payment.findFirstOrThrow({
      where: { orderId: payme.id, status: 'PAID' },
    });
    await prisma.payment.update({
      where: { id: paid.id },
      data: { providerData: { time: 1, createTime: 1, fiscalDetail: true } },
    });
    await lifecycle.completeOrder(payme.id, STAFF());
    expect((await orderOf(payme.id)).status).toBe('COMPLETED');

    const click = await confirmed('CLICK');
    await deliver(click.id, 'BTS-7712004');
    await expect(lifecycle.completeOrder(click.id, STAFF())).rejects.toMatchObject({
      code: 'FISCAL_RECEIPT_REQUIRED',
    });
    await prisma.payment.updateMany({
      where: { orderId: click.id, status: 'PAID' },
      data: { fiscalReceiptUrl: 'https://ofd.soliq.uz/check?t=click1' },
    });
    await lifecycle.completeOrder(click.id, STAFF());
    expect((await orderOf(click.id)).status).toBe('COMPLETED');
  });

  it('a cancelled order gets no receipt', async () => {
    const o = await placeOrder('COD');
    await prisma.$transaction((tx) => lifecycle.transition(tx, o.id, 'CANCELLED', STAFF()));
    await expect(
      fiscal.recordManualReceipt(o.id, { receiptNumber: 'FK-1' }, staffId),
    ).rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION' });
    await expect(
      fiscal.recordManualReceipt('missing-order-id', { receiptNumber: 'FK-1' }, staffId),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
});
