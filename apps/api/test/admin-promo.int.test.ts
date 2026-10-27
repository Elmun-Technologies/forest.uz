import { STAFF_ROLES, type StaffRole } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { shopper } from './app';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

const run = Date.now().toString(36).toUpperCase().slice(-6);
const code = (tag: string) => `T${run}${tag}`;

describe('admin promo codes A14 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  let owner: AdminClient;
  const customerIds: string[] = [];

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    for (const role of STAFF_ROLES) clients.set(role, (await signedIn(app, role)).client);
    owner = clients.get('OWNER')!;
  });

  afterAll(async () => {
    const promos = await prisma.promoCode.findMany({
      where: { code: { startsWith: `T${run}` } },
      select: { id: true },
    });
    await prisma.promoRedemption.deleteMany({
      where: { promoId: { in: promos.map((p) => p.id) } },
    });
    await prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.promoCode.deleteMany({ where: { id: { in: promos.map((p) => p.id) } } });
    await app.close();
  });

  /** An order that used `promoId` (status/device configurable) — redemption stats source. */
  async function redeemed(promoId: string, opts: { device: string; cancelled?: boolean }) {
    const customer = await prisma.customer.create({
      data: { phone: `+99891${Math.floor(1_000_000 + Math.random() * 8_999_999)}` },
    });
    customerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        publicId: `pr-${customer.id}`,
        trackingToken: `pr-${customer.id}`,
        customerId: customer.id,
        status: opts.cancelled ? 'CANCELLED' : 'CONFIRMED',
        contactName: 'Test',
        contactPhone: customer.phone!,
        address: { region: 'tashkent' },
        subtotalTiyin: 50_000_000n,
        discountTiyin: 5_000_000n,
        totalTiyin: 45_000_000n,
        paymentMethod: 'COD',
        deliveryZone: 'tashkent',
        carrier: 'YANDEX',
        offerVersion: '1',
      },
    });
    await prisma.promoRedemption.create({
      data: {
        promoId,
        orderId: order.id,
        customerId: customer.id,
        deviceHash: opts.device,
        discountTiyin: 5_000_000n,
      },
    });
  }

  describe('RBAC per role (docs/02 "Promo codes")', () => {
    const table: [StaffRole, number][] = [
      ['OWNER', 200],
      ['MANAGER', 200],
      ['MARKETER', 200],
      ['OPERATOR', 403],
      ['WAREHOUSE', 403],
    ];
    for (const [role, status] of table) {
      it(`${role}: ${status}`, async () => {
        const c = clients.get(role)!;
        expect((await c.get('/v1/admin/promo')).status).toBe(status);
        expect((await c.get('/v1/admin/promo/summary')).status).toBe(status);
        const res = await c.post('/v1/admin/promo', {
          code: code(`R${role}`),
          type: 'PERCENT',
          value: 5,
        });
        expect(res.status).toBe(status === 200 ? 201 : 403);
      });
    }
  });

  it('enforces the margin guard and type rules server-side', async () => {
    const summary = await owner.get('/v1/admin/promo/summary');
    const max = summary.body.rules.maxDiscountPct as number;
    expect(max).toBe(15);

    let res = await owner.post('/v1/admin/promo', {
      code: code('P20'),
      type: 'PERCENT',
      value: 20,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'PROMO_OVER_MARGIN_GUARD', field: 'value' });
    expect(res.body.error.message).toContain('15%');

    res = await owner.post('/v1/admin/promo', { code: code('F50'), type: 'FIXED', value: 50_000 });
    expect(res.body.error.code).toBe('PROMO_OVER_MARGIN_GUARD');
    res = await owner.post('/v1/admin/promo', {
      code: code('F50').toLowerCase(),
      type: 'FIXED',
      value: 50_000,
      minCartSoum: 400_000,
      utmSource: 'zarina',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: code('F50'),
      minCartSoum: 400_000,
      utmSource: 'zarina',
    });
    const stored = await prisma.promoCode.findUniqueOrThrow({ where: { code: code('F50') } });
    expect(stored.minCartTiyin).toBe(40_000_000n);

    res = await owner.post('/v1/admin/promo', {
      code: code('G'),
      type: 'GIFT',
      minCartSoum: 1_000_000,
    });
    expect(res.body.error.code).toBe('PROMO_GIFT_INVALID');
    const brush = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-BR-40' } });
    // A variant of a product that isn't on sale can't be a gift.
    const draft = await prisma.product.update({
      where: { id: brush.productId },
      data: { status: 'DRAFT' },
    });
    try {
      res = await owner.post('/v1/admin/promo', {
        code: code('GD'),
        type: 'GIFT',
        giftVariantId: brush.id,
        minCartSoum: 1_000_000,
      });
      expect(res.body.error.code).toBe('PROMO_GIFT_INVALID');
    } finally {
      await prisma.product.update({ where: { id: draft.id }, data: { status: 'ACTIVE' } });
    }
    res = await owner.post('/v1/admin/promo', {
      code: code('G'),
      type: 'GIFT',
      value: 99,
      giftVariantId: brush.id,
      minCartSoum: 500_000,
    });
    expect(res.body.error.code).toBe('PROMO_OVER_MARGIN_GUARD');
    res = await owner.post('/v1/admin/promo', {
      code: code('G'),
      type: 'GIFT',
      value: 99,
      giftVariantId: brush.id,
      minCartSoum: 1_000_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe(0);
    expect(res.body.gift).toMatchObject({ sku: 'FR-BR-40', priceSoum: 119_000 });

    res = await owner.post('/v1/admin/promo', {
      code: code('FS'),
      type: 'FREE_SHIPPING',
      value: 7,
      audience: 'FIRST_ORDER',
      perCustomerLimit: 3,
      startsAt: '2026-11-10T00:00:00+05:00',
      endsAt: '2026-11-01T00:00:00+05:00',
    });
    expect(res.body.error.code).toBe('PROMO_DATES_INVALID');
    res = await owner.post('/v1/admin/promo', {
      code: code('FS'),
      type: 'FREE_SHIPPING',
      value: 7,
      audience: 'FIRST_ORDER',
      perCustomerLimit: 3,
      startsAt: '2099-11-01T00:00:00+05:00',
    });
    expect(res.body).toMatchObject({ value: 0, perCustomerLimit: 1, state: 'scheduled' });

    res = await owner.post('/v1/admin/promo', { code: 'SALOM10', type: 'PERCENT', value: 10 });
    expect(res.body.error.code).toBe('PROMO_CODE_TAKEN');
    res = await owner.post('/v1/admin/promo', { code: 'a b', type: 'PERCENT', value: 10 });
    expect(res.status).toBe(400);

    // Updates are checked on the merged record.
    res = await owner.send('patch', `/v1/admin/promo/${stored.id}`, { minCartSoum: 100_000 });
    expect(res.body.error.code).toBe('PROMO_OVER_MARGIN_GUARD');
  });

  it('a created code works in the storefront cart (shared pricing engine)', async () => {
    const res = await owner.post('/v1/admin/promo', {
      code: code('C10'),
      type: 'PERCENT',
      value: 10,
    });
    expect(res.status).toBe(201);
    const cw = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CW-1000' } });
    const agent = shopper(app);
    await agent.post('/v1/cart/items').send({ variantId: cw.id, qty: 1 }).expect(201);
    const applied = await agent.post('/v1/cart/promo').send({ code: code('C10').toLowerCase() });
    expect(applied.status).toBe(201);
    expect(applied.body.promo).toEqual({
      code: code('C10'),
      status: 'applied',
      discountSoum: 32_900,
    });

    await owner.send('patch', `/v1/admin/promo/${res.body.id}`, { active: false });
    const paused = await shopper(app)
      .post('/v1/cart/promo')
      .send({ code: code('C10') });
    expect(paused.body.error.code).toBe('PROMO_INACTIVE');
  });

  it('stats, suspicious device reuse, KPIs, code lock after use, audit', async () => {
    const created = await owner.post('/v1/admin/promo', {
      code: code('S5'),
      type: 'PERCENT',
      value: 5,
      utmSource: 'bot',
    });
    const id = created.body.id as string;
    await redeemed(id, { device: `dev-${run}-shared` });
    await redeemed(id, { device: `dev-${run}-shared` });
    await redeemed(id, { device: `dev-${run}-own` });
    await redeemed(id, { device: `dev-${run}-shared`, cancelled: true });

    const one = await owner.get(`/v1/admin/promo/${id}`);
    expect(one.body.stats).toEqual({
      uses: 3,
      discountSoum: 150_000,
      revenueSoum: 1_350_000,
      suspicious: 2,
    });
    expect(one.body.locked).toBe(true);

    const list = await owner.get(`/v1/admin/promo?q=${code('S5').toLowerCase()}`);
    expect(list.body.items.map((p: { code: string }) => p.code)).toEqual([code('S5')]);
    const summary = await owner.get('/v1/admin/promo/summary');
    expect(summary.body.kpis.suspicious).toBeGreaterThanOrEqual(2);
    expect(summary.body.kpis.discountSoum).toBeGreaterThanOrEqual(150_000);
    expect(summary.body.kpis.ordersWithCodePct).toBeGreaterThan(0);
    expect(summary.body.automatic.kits.length).toBe(2);
    expect(summary.body.automatic.freeShipping.length).toBeGreaterThan(0);

    let res = await owner.send('patch', `/v1/admin/promo/${id}`, { code: code('S6') });
    expect(res.body.error.code).toBe('PROMO_CODE_LOCKED');
    res = await owner.send('patch', `/v1/admin/promo/${id}`, { active: false, usageLimit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('paused');
    const paused = await owner.get('/v1/admin/promo?state=paused');
    expect(paused.body.items.map((p: { id: string }) => p.id)).toContain(id);

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'PromoCode', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['promo.create', 'promo.update']);
    expect(audit[1]!.before).toEqual({ active: true, usageLimit: null });
    expect(audit[1]!.after).toEqual({ active: false, usageLimit: 10 });
  });
});
