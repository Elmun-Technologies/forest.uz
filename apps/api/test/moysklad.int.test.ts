import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Prisma } from '@forest/db';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { MoyskladJobs } from '../src/moysklad/moysklad-jobs.service';
import { MOYSKLAD_LOCK_KEY } from '../src/moysklad/moysklad-lock';
import { MOYSKLAD_QUEUE, ORDERS_SYNC, RECONCILE, STOCK_POLL } from '../src/moysklad/moysklad-queue';
import { catalogLocks } from '../src/moysklad/source-of-truth';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import { signedIn } from './admin-helpers';
import { createTestApp, nextTestIp, shopper } from './app';
import { MoyskladStub, type StubRow } from './moysklad-stub';

/**
 * MoySklad sync against a local stub of the JSON API 1.2 (PROVIDERS_MODE=sandbox → the real
 * adapter): catalog pull and conflict rules, stock poll, order push + state mirror with the hold
 * hand-over, webhooks, 429 handling, flow toggles, admin RBAC + audit, source-of-truth flags.
 */
describe('MoySklad sync', () => {
  const stub = new MoyskladStub();
  const run = Date.now().toString(36);
  const STORE = randomUUID();
  const OTHER_STORE = randomUUID();
  const IKPU = '03208001001000000';
  const sku = (s: string) => `MS-${run}-${s}`;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jobs: MoyskladJobs;
  let integrations: IntegrationsService;
  let lifecycle: OrderLifecycleService;
  let ownerId: string;
  let phoneSeq = 0;
  const createdProductIds: string[] = [];
  const staff = () => ({ type: 'STAFF' as const, id: ownerId });

  // MoySklad catalog: A links to our existing variant by SKU; NEW, the modification product and
  // the kit are unknown to us.
  const ids = {
    a: randomUUID(),
    neu: randomUUID(),
    parent: randomUUID(),
    v1: randomUUID(),
    v2: randomUUID(),
    kit: randomUUID(),
  };
  const price = (tiyin: number) => [
    { value: tiyin, priceType: { name: 'Chakana' } },
    { value: 1, priceType: { name: 'Ulgurji' } },
  ];
  const productRow = (id: string, article: string, tiyin: number, extra: object = {}): StubRow => ({
    id,
    meta: { href: stub.href('product', id), type: 'product' },
    name: `MS ${article}`,
    article,
    salePrices: price(tiyin),
    attributes: [{ name: 'ikpu', value: IKPU }],
    variantsCount: 0,
    ...extra,
  });

  async function setSettings(patch: Record<string, unknown>) {
    const row = await prisma.integration.findUniqueOrThrow({ where: { key: 'moysklad' } });
    const config = { ...((row.config as object | null) ?? {}), ...patch };
    await prisma.integration.update({
      where: { key: 'moysklad' },
      data: { config: config as Prisma.InputJsonValue },
    });
  }

  const variantBySku = (s: string) => prisma.variant.findUniqueOrThrow({ where: { sku: s } });

  async function placeCod(variantSku: string, qty = 1) {
    const variantId = (await variantBySku(variantSku)).id;
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId, qty }).expect(201);
    const res = await agent
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', nextTestIp())
      .set('Idempotency-Key', `ms-${run}-${++phoneSeq}-abcdefgh`)
      .send({
        name: 'Malika Karimova',
        phone: `+9989044${String(phoneSeq).padStart(5, '0')}`,
        region: 'tashkent_city',
        district: 'yunusobod',
        addressLine: 'Yunusobod 4-kvartal, 12-uy',
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'COD',
        offerVersion: 'v1',
      })
      .expect(201);
    return prisma.order.findUniqueOrThrow({ where: { publicId: res.body.publicId } });
  }

  beforeAll(async () => {
    await stub.start();
    app = await createTestApp({ PROVIDERS_MODE: 'sandbox', MOYSKLAD_API_URL: stub.url });
    prisma = app.get(PrismaService);
    jobs = app.get(MoyskladJobs);
    integrations = app.get(IntegrationsService);
    lifecycle = app.get(OrderLifecycleService);
    // The tests drive the jobs themselves.
    const queue = app.get<Queue>(getQueueToken(MOYSKLAD_QUEUE));
    for (const id of [RECONCILE, ORDERS_SYNC, STOCK_POLL]) await queue.removeJobScheduler(id);
    await queue.drain(true);
    await app.get(RedisService).del(MOYSKLAD_LOCK_KEY);

    ownerId = (
      await prisma.staff.create({
        data: { email: `ms-owner-${run}@t.uz`, name: 'O', role: 'OWNER', passwordHash: 'x' },
      })
    ).id;
    // Our existing ACTIVE product whose SKU MoySklad also has (linked on the first pull).
    const seller = await prisma.seller.findFirstOrThrow({ where: { isOfficial: true } });
    const ours = await prisma.product.create({
      data: {
        slug: `ms-ours-${run}`,
        status: 'ACTIVE',
        sellerId: seller.id,
        name: { uz: "Bizning bo'yoq", ru: 'Наша краска' },
        description: { uz: 'Bizning tavsif', ru: 'Наше описание' },
        variants: {
          create: [
            {
              sku: sku('A'),
              label: { uz: '1 L', ru: '1 л' },
              priceTiyin: 30_000_000n,
              stock: 50,
              ikpu: IKPU,
            },
          ],
        },
      },
    });
    createdProductIds.push(ours.id);

    stub.products.push(
      productRow(ids.a, sku('A'), 32_900_000),
      productRow(ids.neu, sku('NEW'), 12_000_000),
      productRow(ids.parent, sku('PAR'), 45_000_000, { variantsCount: 2 }),
    );
    for (const [id, code, label] of [
      [ids.v1, sku('V1'), '1 L'],
      [ids.v2, sku('V2'), '2.5 L'],
    ] as const)
      stub.variants.push({
        id,
        meta: { href: stub.href('variant', id), type: 'variant' },
        name: `MS PAR (${label})`,
        code,
        product: { meta: { href: stub.href('product', ids.parent), type: 'product' } },
        characteristics: [{ name: 'Hajm', value: label }],
        salePrices: [],
      });
    stub.bundles.push({
      id: ids.kit,
      meta: { href: stub.href('bundle', ids.kit), type: 'bundle' },
      name: "MS To'plam",
      article: sku('KIT'),
      salePrices: price(50_000_000),
      attributes: [{ name: 'ikpu', value: IKPU }],
      components: {
        rows: [
          { quantity: 2, assortment: { meta: { href: stub.href('product', ids.neu) } } },
          { quantity: 1, assortment: { meta: { href: stub.href('variant', ids.v1) } } },
        ],
      },
    });
    stub.setStock(STORE, ids.a, 20, 3);
    stub.setStock(STORE, ids.neu, 9);
    stub.setStock(STORE, ids.v1, 4);
    stub.setStock(STORE, ids.v2, 6);
    stub.setStock(OTHER_STORE, ids.a, 100);

    const health = await integrations.connect('moysklad', { token: stub.token }, ownerId, null);
    expect(health).toEqual({ ok: true, message: 'token ok' });
    // Orders placed by earlier test files stay out of MoySklad (as after a real connect).
    await setSettings({
      storeId: STORE,
      flows: { webhooks: true },
      pushSince: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    // Shared DB: later suites count active products and read the moysklad log. Products that
    // appear in orders can't be deleted — they are archived and unlinked instead.
    await prisma.moyskladOrderLink.deleteMany({});
    await prisma.integrationLog.deleteMany({ where: { integrationKey: 'moysklad' } });
    const mine = await prisma.product.findMany({
      where: {
        OR: [{ id: { in: createdProductIds } }, { moyskladId: { in: Object.values(ids) } }],
      },
      select: { id: true },
    });
    const productIds = mine.map((p) => p.id);
    await prisma.variant.updateMany({
      where: { productId: { in: productIds } },
      data: { moyskladId: null, active: false },
    });
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { status: 'ARCHIVED', moyskladId: null },
    });
    await prisma.integration.updateMany({
      where: { key: 'moysklad' },
      data: { status: 'DISCONNECTED', credentials: null, config: {} },
    });
    await app.close();
    await stub.stop();
  });

  it('health check: authenticated gzip GET; a wrong token is reported, not thrown', async () => {
    const org = stub.calls.find((c) => c.path === 'entity/organization');
    expect(org?.auth).toBe(`Bearer ${stub.token}`);
    const bad = await integrations.test('moysklad', { token: 'wrong' });
    expect(bad).toEqual({ ok: false, message: 'token rejected by MoySklad (401/403)' });
  });

  it('full pull links by SKU, MoySklad wins price/stock, content stays ours, new items → DRAFT', async () => {
    const before = await prisma.product.findUniqueOrThrow({ where: { id: createdProductIds[0] } });
    expect(await jobs.reconcile()).toMatchObject({ checked: 5, created: 4, errors: 0 });

    const a = await variantBySku(sku('A'));
    expect(a).toMatchObject({
      moyskladId: ids.a,
      priceTiyin: 32_900_000n,
      stock: 17,
      active: true,
    });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: createdProductIds[0] } });
    expect(after.name).toEqual(before.name);
    expect(after.description).toEqual(before.description);
    expect(after.status).toBe('ACTIVE');
    // Linked by SKU → the product is linked too, so new modifications of it join it.
    expect(after.moyskladId).toBe(ids.a);

    const neu = await prisma.variant.findUniqueOrThrow({
      where: { sku: sku('NEW') },
      include: { product: true },
    });
    expect(neu.product).toMatchObject({ status: 'DRAFT', type: 'SIMPLE', moyskladId: ids.neu });
    expect(neu).toMatchObject({ priceTiyin: 12_000_000n, stock: 9, ikpu: IKPU });

    const v1 = await prisma.variant.findUniqueOrThrow({
      where: { sku: sku('V1') },
      include: { product: true },
    });
    const v2 = await variantBySku(sku('V2'));
    expect(v1.product.moyskladId).toBe(ids.parent);
    expect(v2.productId).toBe(v1.productId);
    // Modifications without their own price take the product's.
    expect([v1.priceTiyin, v2.priceTiyin, v1.label]).toEqual([
      45_000_000n,
      45_000_000n,
      { uz: '1 L', ru: '1 L' },
    ]);

    const kit = await prisma.variant.findUniqueOrThrow({
      where: { sku: sku('KIT') },
      include: { product: true },
    });
    expect(kit.product.type).toBe('BUNDLE');
    expect(kit.stock).toBe(4); // min(⌊9/2⌋, ⌊4/1⌋)
    const items = await prisma.bundleItem.findMany({ where: { bundleId: kit.productId } });
    expect(items.map((i) => i.qty).sort()).toEqual([1, 2]);
    for (const v of [neu, v1]) createdProductIds.push(v.productId);
    createdProductIds.push(kit.productId);

    // Small pages: the adapter followed meta.nextHref.
    expect(stub.calls.filter((c) => c.path === 'entity/product').length).toBeGreaterThanOrEqual(2);
    const log = await prisma.integrationLog.findMany({
      where: { integrationKey: 'moysklad', kind: 'price' },
    });
    expect(log.some((l) => l.message.startsWith(`${sku('A')}: 300`))).toBe(true);
  });

  it('later MoySklad price/stock changes win over local edits; flows off keep ours', async () => {
    await prisma.variant.update({
      where: { sku: sku('A') },
      data: { priceTiyin: 1_000_000n, stock: 999 },
    });
    stub.products[0]!.salePrices = price(33_900_000);
    await jobs.reconcile();
    expect(await variantBySku(sku('A'))).toMatchObject({ priceTiyin: 33_900_000n, stock: 17 });

    await setSettings({ flows: { webhooks: true, prices: false } });
    stub.products[0]!.salePrices = price(34_900_000);
    await jobs.reconcile();
    expect((await variantBySku(sku('A'))).priceTiyin).toBe(33_900_000n);
    expect(await catalogLocks(prisma)).toEqual({ source: 'moysklad', price: false, stock: true });
    await setSettings({ flows: { webhooks: true, products: false } });
    expect(await catalogLocks(prisma)).toEqual({ source: 'local', price: true, stock: true });
    expect(await jobs.reconcile()).toBe('off');
    await setSettings({ flows: { webhooks: true } });
    expect(await catalogLocks(prisma)).toEqual({ source: 'moysklad', price: true, stock: true });
  });

  it('stock poll updates linked variants and kits; stock flow off skips it', async () => {
    stub.setStock(STORE, ids.v1, 1);
    stub.setStock(STORE, ids.a, 30, 10);
    expect(await jobs.stock(false)).toBe(2 + 1);
    expect((await variantBySku(sku('A'))).stock).toBe(20);
    expect((await variantBySku(sku('KIT'))).stock).toBe(1);
    await setSettings({ flows: { webhooks: true, stock: false } });
    stub.setStock(STORE, ids.a, 1);
    expect(await jobs.stock(false)).toBe('off');
    await setSettings({ flows: { webhooks: true } });
    stub.setStock(STORE, ids.a, 30, 10);
  });

  it('item deleted in MoySklad → variant inactive (never deleted); back → active again', async () => {
    const idx = stub.products.findIndex((p) => p.id === ids.neu);
    const [removed] = stub.products.splice(idx, 1);
    await jobs.reconcile();
    expect((await variantBySku(sku('NEW'))).active).toBe(false);
    stub.products.push(removed!);
    await jobs.reconcile();
    expect((await variantBySku(sku('NEW'))).active).toBe(true);
    // Archived counts as gone too.
    removed!.archived = true;
    await jobs.reconcile();
    expect((await variantBySku(sku('NEW'))).active).toBe(false);
    removed!.archived = false;
    await jobs.reconcile();
  });

  it('pushes a confirmed order once: counterparty by phone, positions, reserve, state; hold handed over', async () => {
    const order = await placeCod(sku('A'), 2);
    const v0 = await variantBySku(sku('A'));
    expect(v0.reserved).toBe(2);
    // NEW orders are never pushed.
    expect(await jobs.orders(false)).toMatchObject({ pushed: 0 });
    await lifecycle.confirmCod(order.id, staff());
    expect(await jobs.orders(false)).toMatchObject({ pushed: 1, failed: 0 });

    const link = await prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId: order.id } });
    const pushed = stub.orders.get(link.externalId!)!;
    expect(pushed.body).toMatchObject({
      name: order.number,
      organization: { meta: { href: stub.href('organization', stub.organizationId) } },
      store: { meta: { href: stub.href('store', STORE) } },
      attributes: [{ value: expect.stringContaining('YANDEX') }],
    });
    expect(pushed.body.description).not.toContain('Malika');
    expect(stub.stateName(pushed.stateId)).toBe('Подтвержден');
    expect(pushed.positions).toEqual([expect.objectContaining({ quantity: 2, reserve: 2 })]);
    const cp = stub.counterparties.find((c) => c.phone === order.contactPhone);
    expect((pushed.body.agent as { meta: { href: string } }).meta.href).toBe(
      stub.href('counterparty', cp!.id),
    );
    expect(link).toMatchObject({ pushedStatus: 'CONFIRMED', holdHandedOver: true, attempts: 0 });

    // Hold handed over: our reservation ended, stock dropped by the same qty (sellable unchanged).
    const v1 = await variantBySku(sku('A'));
    expect([v1.reserved, v1.stock]).toEqual([0, v0.stock - 2]);
    expect(await prisma.reservation.count({ where: { orderId: order.id, releasedAt: null } })).toBe(
      0,
    );

    // Retries and duplicate jobs don't create a second customer order.
    const posts = stub.count('POST', 'entity/customerorder');
    expect(await jobs.orders(false)).toMatchObject({ pushed: 0 });
    // A crash after MoySklad created the order (link lost) → found by name, not re-created.
    await prisma.moyskladOrderLink.update({
      where: { orderId: order.id },
      data: { externalId: null },
    });
    expect(await jobs.orders(false)).toMatchObject({ pushed: 1 });
    expect(stub.count('POST', 'entity/customerorder')).toBe(posts);
    expect(
      (await prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId: order.id } }))
        .externalId,
    ).toBe(link.externalId);
    // The same phone reuses its counterparty.
    expect(stub.counterparties.filter((c) => c.phone === order.contactPhone)).toHaveLength(1);
  });

  it('mirrors status changes: packing → state; cancel → state + reserve released in MoySklad', async () => {
    const order = await placeCod(sku('A'));
    await lifecycle.confirmCod(order.id, staff());
    await jobs.orders(false);
    const link = await prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId: order.id } });
    await prisma.$transaction((tx) => lifecycle.transition(tx, order.id, 'PACKING', staff()));
    expect(await jobs.orders(false)).toMatchObject({ updated: 1 });
    expect(stub.stateName(stub.orders.get(link.externalId!)!.stateId)).toBe('Собран');

    await lifecycle.cancelOrder(order.id, staff(), 'test');
    expect(await jobs.orders(false)).toMatchObject({ updated: 1 });
    const o = stub.orders.get(link.externalId!)!;
    expect(stub.stateName(o.stateId)).toBe('Отменен');
    expect(o.positions.every((p) => p.reserve === 0)).toBe(true);
    expect(
      await prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({
      pushedStatus: 'CANCELLED',
    });
    // Nothing left to mirror.
    expect(await jobs.orders(false)).toMatchObject({ updated: 0 });
  });

  it('a failing push backs off and is logged; an unlinked SKU is never sent', async () => {
    stub.fail('POST entity/customerorder', {
      status: 500,
      body: { errors: [{ error: 'boom', code: 1000 }] },
    });
    const order = await placeCod(sku('A'));
    await lifecycle.confirmCod(order.id, staff());
    expect(await jobs.orders(false)).toMatchObject({ failed: 1 });
    const link = await prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(link).toMatchObject({ externalId: null, attempts: 1 });
    // The counterparty created before the failure is kept for the retry.
    expect(link.counterpartyId).toBe(
      stub.counterparties.find((c) => c.phone === order.contactPhone)?.id,
    );
    expect(link.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // Not due yet → not retried; due → pushed.
    expect(await jobs.orders(false)).toMatchObject({ pushed: 0, failed: 0 });
    await prisma.moyskladOrderLink.update({
      where: { orderId: order.id },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(await jobs.orders(false)).toMatchObject({ pushed: 1 });
    const errors = await prisma.integrationLog.count({
      where: {
        integrationKey: 'moysklad',
        kind: 'order',
        ok: false,
        message: { contains: order.number },
      },
    });
    expect(errors).toBe(1);
  });

  it('orders flow off: nothing is pushed', async () => {
    await setSettings({ flows: { webhooks: true, orders: false } });
    const order = await placeCod(sku('A'));
    await lifecycle.confirmCod(order.id, staff());
    expect(await jobs.orders(false)).toMatchObject({ pushed: 0 });
    expect(await prisma.moyskladOrderLink.count({ where: { orderId: order.id } })).toBe(0);
    await setSettings({ flows: { webhooks: true } });
    await lifecycle.cancelOrder(order.id, staff(), 'test');
  });

  it('429: waits X-Lognex-Retry-After and retries, also for POSTs', async () => {
    const before = stub.count('GET', 'entity/organization');
    stub.fail('GET entity/organization', {
      status: 429,
      headers: { 'X-Lognex-Retry-After': '20' },
    });
    expect((await integrations.test('moysklad')).ok).toBe(true);
    expect(stub.count('GET', 'entity/organization')).toBe(before + 2);

    stub.fail('POST entity/counterparty', { status: 429, headers: { 'X-Lognex-Auth': '429005' } });
    const order = await placeCod(sku('A'));
    await lifecycle.confirmCod(order.id, staff());
    const posts = stub.count('POST', 'entity/counterparty');
    expect(await jobs.orders(false)).toMatchObject({ pushed: 1 });
    expect(stub.count('POST', 'entity/counterparty')).toBe(posts + 2);
  });

  describe('stock holds, prices and reports (review fixes)', () => {
    const sellable = async (s: string) => {
      const v = await variantBySku(s);
      return v.stock - v.reserved;
    };
    const toCourier = (orderId: string) =>
      prisma.$transaction(async (tx) => {
        for (const to of ['PACKING', 'READY', 'HANDED_TO_COURIER'] as const)
          await lifecycle.transition(tx, orderId, to, staff());
      });
    const linkOf = (orderId: string) =>
      prisma.moyskladOrderLink.findUniqueOrThrow({ where: { orderId } });
    afterEach(() => setSettings({ flows: { webhooks: true } }));

    it('stock flow off: no hand-over; cancel gives the hold back; MoySklad reserve dropped', async () => {
      await setSettings({ flows: { webhooks: true, stock: false } });
      const s0 = await sellable(sku('A'));
      const stock0 = (await variantBySku(sku('A'))).stock;
      const order = await placeCod(sku('A'), 2);
      await lifecycle.confirmCod(order.id, staff());
      expect(await jobs.orders(false)).toMatchObject({ pushed: 1 });
      const link = await linkOf(order.id);
      expect(link.holdHandedOver).toBe(false);
      expect(stub.orders.get(link.externalId!)!.positions[0]!.reserve).toBe(2);
      expect((await variantBySku(sku('A'))).stock).toBe(stock0);
      expect(await sellable(sku('A'))).toBe(s0 - 2);

      await lifecycle.cancelOrder(order.id, staff(), 'test');
      expect(await sellable(sku('A'))).toBe(s0);
      await jobs.orders(false);
      expect(stub.orders.get(link.externalId!)!.positions[0]!.reserve).toBe(0);
    });

    it('hand to courier without hand-over: the hold is consumed from our stock (stock flow off)', async () => {
      await setSettings({ flows: { webhooks: true, stock: false } });
      const before = await variantBySku(sku('A'));
      const order = await placeCod(sku('A'), 1);
      await lifecycle.confirmCod(order.id, staff());
      await jobs.orders(false);
      await toCourier(order.id);
      const after = await variantBySku(sku('A'));
      expect([after.stock, after.reserved]).toEqual([before.stock - 1, before.reserved]);
      expect(
        await prisma.reservation.count({ where: { orderId: order.id, releasedAt: null } }),
      ).toBe(0);
      // Idempotent: nothing left to end on later steps.
      await prisma.$transaction((tx) => lifecycle.transition(tx, order.id, 'DELIVERED', staff()));
      expect((await variantBySku(sku('A'))).stock).toBe(before.stock - 1);
    });

    it('hand to courier with the MoySklad stock flow on: the hold is only released', async () => {
      await setSettings({ flows: { webhooks: true, orders: false } });
      const before = await variantBySku(sku('A'));
      const order = await placeCod(sku('A'), 1);
      await lifecycle.confirmCod(order.id, staff());
      await toCourier(order.id);
      const after = await variantBySku(sku('A'));
      // MoySklad's own stock drops when the warehouse ships there; the next snapshot shows it.
      expect([after.stock, after.reserved]).toEqual([before.stock, before.reserved]);
    });

    it('hand-over, then stock flow switched off, then cancel → our stock is restored once', async () => {
      const s0 = await sellable(sku('A'));
      const order = await placeCod(sku('A'), 2);
      await lifecycle.confirmCod(order.id, staff());
      await jobs.orders(false);
      expect((await linkOf(order.id)).holdHandedOver).toBe(true);
      expect(await sellable(sku('A'))).toBe(s0 - 2);
      await setSettings({ flows: { webhooks: true, stock: false } });
      await lifecycle.cancelOrder(order.id, staff(), 'test');
      expect(await sellable(sku('A'))).toBe(s0);
      expect((await linkOf(order.id)).holdHandedOver).toBe(false);
    });

    it('statuses flow off: cancel still drops the MoySklad reserve (no state name sent)', async () => {
      await setSettings({ flows: { webhooks: true, statuses: false } });
      const order = await placeCod(sku('A'), 1);
      await lifecycle.confirmCod(order.id, staff());
      await jobs.orders(false);
      const link = await linkOf(order.id);
      const pushed = stub.orders.get(link.externalId!)!;
      expect(pushed.stateId).toBeNull();
      expect(pushed.positions[0]!.reserve).toBe(1);
      await lifecycle.cancelOrder(order.id, staff(), 'test');
      expect(await jobs.orders(false)).toMatchObject({ updated: 1 });
      expect(pushed.positions[0]!.reserve).toBe(0);
      expect(pushed.stateId).toBeNull();
    });

    it('a zero or foreign-currency price is never written; the error is logged', async () => {
      const a = stub.products.find((p) => p.id === ids.a)!;
      const saved = a.salePrices;
      const priceBefore = (await variantBySku(sku('A'))).priceTiyin;
      a.salePrices = price(0);
      await jobs.reconcile();
      expect((await variantBySku(sku('A'))).priceTiyin).toBe(priceBefore);
      const rub = stub.currencies.find((c) => c.isoCode === 'RUB')!;
      a.salePrices = [
        {
          value: 99_000,
          currency: { meta: { href: stub.href('currency', rub.id) } },
          priceType: { name: 'Chakana' },
        },
      ];
      await jobs.reconcile();
      expect((await variantBySku(sku('A'))).priceTiyin).toBe(priceBefore);
      const errors = await prisma.integrationLog.findMany({
        where: { integrationKey: 'moysklad', ok: false, message: { startsWith: sku('A') } },
      });
      expect(errors.map((e) => e.message).join('\n')).toMatch(/narx yo'q[\s\S]*RUB/);
      a.salePrices = saved;
    });

    it('health check fails when the account currency is not UZS', async () => {
      const [uzs, rub] = stub.currencies;
      uzs!.default = false;
      rub!.default = true;
      const health = await integrations.test('moysklad');
      expect(health.ok).toBe(false);
      expect(health.message).toContain('RUB');
      uzs!.default = true;
      rub!.default = false;
    });

    it('an empty stock report changes nothing and is logged', async () => {
      const saved = new Map(stub.stock);
      const before = (await variantBySku(sku('A'))).stock;
      stub.stock.clear();
      expect(await jobs.stock(false)).toBe(0);
      expect((await variantBySku(sku('A'))).stock).toBe(before);
      expect(
        await prisma.integrationLog.count({
          where: { integrationKey: 'moysklad', kind: 'stock', ok: false },
        }),
      ).toBeGreaterThanOrEqual(1);
      for (const [k, v] of saved) stub.stock.set(k, v);
    });
  });

  it('webhook: secret path, enqueues a targeted refresh; wrong token 404', async () => {
    const token = (await integrations.credentials('moysklad')).webhookToken!;
    await request(app.getHttpServer())
      .post(`/v1/webhooks/moysklad/${'x'.repeat(token.length)}`)
      .send({ events: [] })
      .expect(404);
    const queue = app.get<Queue>(getQueueToken(MOYSKLAD_QUEUE));
    await request(app.getHttpServer())
      .post(`/v1/webhooks/moysklad/${token}`)
      .send({
        events: [
          {
            meta: { type: 'product', href: stub.href('product', ids.a) },
            action: 'UPDATE',
            accountId: 'acc',
          },
        ],
      })
      .expect(200);
    expect(await queue.getJob(`item-product-${ids.a}`)).toBeTruthy();

    stub.products[0]!.salePrices = price(35_900_000);
    await jobs.item({ type: 'product', id: ids.a });
    expect((await variantBySku(sku('A'))).priceTiyin).toBe(35_900_000n);

    // A deletion event → the variant is deactivated.
    const idx = stub.products.findIndex((p) => p.id === ids.neu);
    const [removed] = stub.products.splice(idx, 1);
    await jobs.item({ type: 'product', id: ids.neu });
    expect((await variantBySku(sku('NEW'))).active).toBe(false);
    stub.products.push(removed!);

    // Stock webhook → one debounced stock refresh.
    await request(app.getHttpServer())
      .post(`/v1/webhooks/moysklad/${token}`)
      .send({
        accountId: 'acc',
        stockType: 'stock',
        reportType: 'bystore',
        reportUrl: `${stub.url}/report/stock/bystore/current`,
      })
      .expect(200);
    expect(await queue.getJob('stock-refresh')).toBeTruthy();

    // Webhooks flow off → accepted but ignored.
    await setSettings({ flows: { webhooks: false } });
    await queue.remove(`item-product-${ids.v1}`).catch(() => undefined);
    await request(app.getHttpServer())
      .post(`/v1/webhooks/moysklad/${token}`)
      .send({
        events: [
          { meta: { type: 'variant', href: stub.href('variant', ids.v1) }, action: 'UPDATE' },
        ],
      })
      .expect(200);
    expect(await queue.getJob(`item-variant-${ids.v1}`)).toBeFalsy();
    await setSettings({ flows: { webhooks: true } });
  });

  it('admin API: RBAC, audit, status/KPIs, settings, sync now, log, webhook URL reveal', async () => {
    const owner = await signedIn(app, 'OWNER');
    const manager = await signedIn(app, 'MANAGER');
    const warehouse = await signedIn(app, 'WAREHOUSE');
    const marketer = await signedIn(app, 'MARKETER');

    const status = await owner.client.get('/v1/admin/moysklad/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      connection: 'CONNECTED',
      usingFake: false,
      kpis: { linkedSkus: expect.any(Number), ordersPushedToday: expect.any(Number) },
      settings: { storeId: STORE, priceType: 'Chakana' },
      sourceOfTruth: { source: 'moysklad', price: true, stock: true },
    });
    expect(status.body.kpis.ordersPushedToday).toBeGreaterThanOrEqual(3);
    expect(status.body.connectionInfo.tokenMasked).toBe(`•••• •••• ${stub.token.slice(-4)}`);
    const token = (await integrations.credentials('moysklad')).webhookToken!;
    expect(JSON.stringify(status.body)).not.toContain(token);
    expect(JSON.stringify(status.body)).not.toContain(stub.token);

    expect((await warehouse.client.get('/v1/admin/moysklad/status')).status).toBe(200);
    expect((await marketer.client.get('/v1/admin/moysklad/status')).status).toBe(403);
    expect(
      (await warehouse.client.send('patch', '/v1/admin/moysklad/settings', { priceType: 'X' }))
        .status,
    ).toBe(403);

    const patched = await manager.client.send('patch', '/v1/admin/moysklad/settings', {
      stockPollMinutes: 10,
      stateMap: { PACKING: "Yig'ilmoqda" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.settings).toMatchObject({
      stockPollMinutes: 10,
      stateMap: { PACKING: "Yig'ilmoqda" },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'moysklad.settings_update', staffId: manager.id },
    });
    expect(audit.after).toMatchObject({ stockPollMinutes: 10 });
    expect(
      (await manager.client.send('patch', '/v1/admin/moysklad/settings', { pushSince: null }))
        .status,
    ).toBe(400);

    const logsBefore = await prisma.integrationLog.count({
      where: { integrationKey: 'moysklad', kind: 'sync' },
    });
    const sync = await warehouse.client.post('/v1/admin/moysklad/sync', { scope: 'stock' });
    expect(sync.status).toBe(202);
    expect(
      await prisma.auditLog.count({
        where: { action: 'moysklad.sync_now', staffId: warehouse.id },
      }),
    ).toBe(1);
    // The queued job runs in this app's worker and writes its summary row.
    for (let i = 0; i < 50; i++) {
      const n = await prisma.integrationLog.count({
        where: { integrationKey: 'moysklad', kind: 'sync' },
      });
      if (n > logsBefore) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      await prisma.integrationLog.count({ where: { integrationKey: 'moysklad', kind: 'sync' } }),
    ).toBeGreaterThan(logsBefore);

    const page1 = await owner.client.get('/v1/admin/moysklad/log?limit=3');
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await owner.client.get(
      `/v1/admin/moysklad/log?limit=3&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.items[0].id).not.toBe(page1.body.items[2].id);
    const errorsOnly = await owner.client.get('/v1/admin/moysklad/log?ok=false');
    expect(errorsOnly.body.items.every((i: { ok: boolean }) => !i.ok)).toBe(true);

    expect((await manager.client.post('/v1/admin/moysklad/webhook-url')).status).toBe(403);
    const reveal = await owner.client.post('/v1/admin/moysklad/webhook-url');
    expect(reveal.body.webhookUrl).toMatch(new RegExp(`/v1/webhooks/moysklad/${token}$`));
    expect(
      await prisma.auditLog.count({
        where: { action: 'moysklad.webhook_reveal', staffId: owner.id },
      }),
    ).toBe(1);

    // Our API URL in tests is http://localhost → MoySklad could never call it.
    const reg = await owner.client.post('/v1/admin/moysklad/webhooks/register');
    expect(reg.status).toBe(409);
    expect(reg.body.error.code).toBe('MOYSKLAD_WEBHOOK_URL_UNAVAILABLE');
  });
});
