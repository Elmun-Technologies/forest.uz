import { randomBytes } from 'node:crypto';
import type {
  CustomerDetailDto,
  CustomerListDto,
  CustomerListItemDto,
  StaffRole,
} from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

const DAY = 86_400_000;
const run = randomBytes(3).toString('hex');
const tag = `seg${run}`;

let phoneSeq = 0;
function phone(): string {
  phoneSeq++;
  const n = (Number.parseInt(run, 16) * 13 + phoneSeq) % 10_000_000;
  return `+99897${String(n).padStart(7, '0')}`;
}

describe('admin customers A4/A5 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  let variant: { id: string; productId: string };
  const ids: Record<string, string> = {};
  const phones: Record<string, string> = {};
  let orderNumberOfC = '';

  async function customer(
    key: string,
    data: { createdAt?: Date; leadSource?: string; leadAt?: Date; withPhone?: boolean } = {},
  ) {
    const p = phone();
    const c = await prisma.customer.create({
      data: {
        phone: data.withPhone === false ? null : p,
        name: `${tag} ${key}`,
        createdAt: data.createdAt ?? new Date(),
        leadSource: data.leadSource ?? null,
        leadAt: data.leadAt ?? null,
      },
    });
    ids[key] = c.id;
    phones[key] = p;
    return c;
  }

  async function order(
    customerId: string,
    opts: {
      soum: number;
      at: Date;
      status?: string;
      payment?: 'PAID' | 'PARTIALLY_REFUNDED' | 'PENDING';
      refundSoum?: number;
      region?: string;
    },
  ) {
    const tiyin = BigInt(opts.soum) * 100n;
    const o = await prisma.order.create({
      data: {
        publicId: randomBytes(8).toString('hex'),
        trackingToken: randomBytes(8).toString('hex'),
        customerId,
        status: (opts.status ?? 'DELIVERED') as 'DELIVERED',
        contactName: 'Test',
        contactPhone: '+998971112233',
        address: { region: opts.region ?? 'tashkent_city', district: null, line: 'Amir Temur 1' },
        subtotalTiyin: tiyin,
        totalTiyin: tiyin,
        paymentMethod: 'PAYME',
        deliveryZone: 'tashkent-city-yandex',
        carrier: 'YANDEX',
        offerVersion: 'test',
        createdAt: opts.at,
        items: {
          create: {
            variantId: variant.id,
            sellerId: (await prisma.seller.findFirstOrThrow()).id,
            nameSnapshot: { uz: 'Test', ru: 'Test' },
            sku: 'T',
            ikpu: '00000000000000000',
            vatPercent: 12,
            qty: 1,
            priceTiyin: tiyin,
          },
        },
      },
    });
    if (opts.payment) {
      const pay = await prisma.payment.create({
        data: { orderId: o.id, method: 'PAYME', status: opts.payment, amountTiyin: tiyin },
      });
      if (opts.refundSoum)
        await prisma.refund.create({
          data: {
            paymentId: pay.id,
            amountTiyin: BigInt(opts.refundSoum) * 100n,
            reason: 'test',
            staffId: 'test',
          },
        });
    }
    return o;
  }

  const list = async (query: string, role: StaffRole = 'OWNER') => {
    const res = await clients.get(role)!.get(`/v1/admin/customers?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as CustomerListDto;
  };
  const names = (items: CustomerListItemDto[]) =>
    items.map((i) => i.name?.replace(`${tag} `, '')).sort();

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const)
      clients.set(role, (await signedIn(app, role)).client);
    variant = await prisma.variant.findFirstOrThrow({ select: { id: true, productId: true } });
    const now = Date.now();

    // A: fresh lead, no orders.
    await customer('A', { leadSource: 'popup', leadAt: new Date() });
    // B: two paid orders (300k each), customer for 100 days → loyal by count.
    const b = await customer('B', { createdAt: new Date(now - 100 * DAY) });
    await order(b.id, { soum: 300_000, at: new Date(now - 20 * DAY), payment: 'PAID' });
    await order(b.id, { soum: 300_000, at: new Date(now - 10 * DAY), payment: 'PAID' });
    await prisma.address.create({
      data: { customerId: b.id, region: 'bukhara', line: 'Secret street 7', isDefault: true },
    });
    // C: one big paid order → loyal by LTV; bought `variant`.
    const c = await customer('C', { createdAt: new Date(now - 50 * DAY) });
    orderNumberOfC = (
      await order(c.id, { soum: 2_500_000, at: new Date(now - 5 * DAY), payment: 'PAID' })
    ).number;
    // D: last seen 90 days ago → inactive.
    const d = await customer('D', { createdAt: new Date(now - 200 * DAY) });
    await order(d.id, {
      soum: 100_000,
      at: new Date(now - 90 * DAY),
      payment: 'PAID',
      region: 'samarkand',
    });
    // E: cart with items untouched for 3 days, no order → abandoned (+ lead).
    const e = await customer('E', { createdAt: new Date(now - 40 * DAY), leadSource: 'selector' });
    const cart = await prisma.cart.create({
      data: { customerId: e.id, items: { create: { variantId: variant.id, qty: 1 } } },
    });
    await prisma.$executeRaw`UPDATE "Cart" SET "updatedAt" = ${new Date(now - 3 * DAY)} WHERE id = ${cart.id}`;
    // F: 3 000 000 paid, 1 500 000 refunded → LTV 1 500 000, not loyal.
    const f = await customer('F', { createdAt: new Date(now - 45 * DAY) });
    await order(f.id, {
      soum: 3_000_000,
      at: new Date(now - 4 * DAY),
      payment: 'PARTIALLY_REFUNDED',
      refundSoum: 1_500_000,
    });
    // G: an open unpaid order → lead; erase refused.
    const g = await customer('G', { createdAt: new Date(now - 35 * DAY) });
    await order(g.id, {
      soum: 200_000,
      at: new Date(now - 1 * DAY),
      status: 'NEW',
      payment: 'PENDING',
    });
    // H: erased earlier → never listed.
    const h = await customer('H');
    await prisma.customer.update({ where: { id: h.id }, data: { deletedAt: new Date() } });
  });
  afterAll(async () => {
    await app.close();
  });

  it('computes segments and chip counts server-side', async () => {
    const all = await list(`q=${tag}`);
    expect(names(all.items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(all.counts).toEqual({ all: 7, new: 1, loyal: 2, abandoned: 1, inactive: 1, leads: 3 });
    const seg = async (s: string) => names((await list(`q=${tag}&segment=${s}`)).items);
    expect(await seg('new')).toEqual(['A']);
    expect(await seg('loyal')).toEqual(['B', 'C']);
    expect(await seg('abandoned')).toEqual(['E']);
    expect(await seg('inactive')).toEqual(['D']);
    expect(await seg('leads')).toEqual(['A', 'E', 'G']);
    const byName = new Map(all.items.map((i) => [i.name, i]));
    expect(byName.get(`${tag} E`)!.segments[0]).toBe('abandoned');
    expect(byName.get(`${tag} F`)).toMatchObject({ purchases: 1, ltvSoum: 1_500_000 });
    expect(byName.get(`${tag} B`)).toMatchObject({
      purchases: 2,
      ltvSoum: 600_000,
      region: 'bukhara',
    });
    expect(byName.get(`${tag} D`)).toMatchObject({ region: 'samarkand' });
    expect(byName.get(`${tag} A`)).toMatchObject({ firstSource: 'popup', purchases: 0 });
  });

  it('masks phones in lists', async () => {
    const res = await clients.get('OPERATOR')!.get(`/v1/admin/customers?q=${tag}`);
    expect(res.status).toBe(200);
    for (const p of Object.values(phones)) expect(JSON.stringify(res.body)).not.toContain(p);
    const items = (res.body as CustomerListDto).items;
    expect(items.every((i) => i.phoneMasked === null || /\*\*\* \*\*/.test(i.phoneMasked))).toBe(
      true,
    );
  });

  it('filters by region, source, product, LTV and searches by order number', async () => {
    expect(names((await list(`q=${tag}&region=samarkand`)).items)).toEqual(['D']);
    expect(names((await list(`q=${tag}&source=selector`)).items)).toEqual(['E']);
    expect(names((await list(`q=${tag}&ltvMin=1000000`)).items)).toEqual(['C', 'F']);
    expect(names((await list(`q=${tag}&ltvMin=500000&ltvMax=2000000`)).items)).toEqual(['B', 'F']);
    const bought = names((await list(`q=${tag}&productId=${variant.productId}`)).items);
    expect(bought).toEqual(['B', 'C', 'D', 'F']); // paid orders only (G unpaid)
    expect(names((await list(`q=${orderNumberOfC}`)).items)).toEqual(['C']);
    const digits = phones.C!.slice(-7);
    expect(names((await list(`q=${digits}`)).items)).toContain('C');
  });

  it('pages with a cursor without gaps or duplicates (each sort)', async () => {
    for (const sort of ['activity', 'ltv', 'orders', 'created']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: CustomerListDto = await list(
          `q=${tag}&sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    }
    const bad = await clients.get('OWNER')!.get('/v1/admin/customers?cursor=@@@');
    expect(bad.status).toBe(400);
  });

  it('RBAC: list O/M/Op; Warehouse and Marketer denied; export/erase Owner only', async () => {
    for (const [role, status] of [
      ['MANAGER', 200],
      ['OPERATOR', 200],
      ['WAREHOUSE', 403],
      ['MARKETER', 403],
    ] as const) {
      expect((await clients.get(role)!.get(`/v1/admin/customers?q=${tag}`)).status).toBe(status);
      expect((await clients.get(role)!.get(`/v1/admin/customers/${ids.A}`)).status).toBe(status);
    }
    for (const role of ['MANAGER', 'OPERATOR'] as const) {
      const c = clients.get(role)!;
      expect((await c.post('/v1/admin/customers/export', { q: tag })).status).toBe(403);
      expect((await c.post(`/v1/admin/customers/${ids.A}/export`)).status).toBe(403);
      expect((await c.post(`/v1/admin/customers/${ids.A}/erase`, { confirm: 'x' })).status).toBe(
        403,
      );
    }
    expect(
      (await clients.get('WAREHOUSE')!.post(`/v1/admin/customers/${ids.A}/reveal`)).status,
    ).toBe(403);
  });

  it('detail: KPIs, orders, timeline, masked phone', async () => {
    const res = await clients.get('OPERATOR')!.get(`/v1/admin/customers/${ids.B}`);
    expect(res.status).toBe(200);
    const d = res.body as CustomerDetailDto;
    expect(d.kpis).toEqual({ ltvSoum: 600_000, purchases: 2, aovSoum: 300_000, ordersTotal: 2 });
    expect(d.orders).toHaveLength(2);
    expect(d.orders[0]!.paymentStatus).toBe('PAID');
    expect(d.phoneMasked).toMatch(/\*\*\*/);
    expect(JSON.stringify(d)).not.toContain(phones.B);
    expect(JSON.stringify(d)).not.toContain('Secret street');
    expect(d.addressesCount).toBe(1);
    expect(d.timeline.filter((x) => x.kind === 'order_created')).toHaveLength(2);
    expect(d.segments).toContain('loyal');
    expect((await clients.get('OWNER')!.get('/v1/admin/customers/nope')).status).toBe(404);
    const plain = (await clients.get('OWNER')!.get(`/v1/admin/customers/${ids.C}`)).body;
    expect(plain.tags).toEqual([]);
  });

  it('reveal returns full data and writes customer.view_pii (field names only)', async () => {
    const res = await clients.get('OPERATOR')!.post(`/v1/admin/customers/${ids.B}/reveal`);
    expect(res.status).toBe(200);
    expect(res.body.phone.replace(/\s/g, '')).toBe(phones.B);
    expect(res.body.addresses[0].line).toBe('Secret street 7');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'customer.view_pii', entityId: ids.B },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.after).toEqual({ fields: ['phone', 'addresses', 'telegramUsername'] });
    expect(JSON.stringify(audit)).not.toContain('Secret street');
  });

  it('tags and notes are audited without note text', async () => {
    const c = clients.get('OPERATOR')!;
    const tags = await c.send('patch', `/v1/admin/customers/${ids.A}/tags`, { tags: ['x'] });
    expect(tags.status).toBe(404); // PUT only
    const put = await c.agent
      .put(`/v1/admin/customers/${ids.A}/tags`)
      .set('X-Forwarded-For', c.ip)
      .set('X-CSRF-Token', c.csrf!)
      .send({ tags: ['#Divan', 'mebel', 'divan'] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.tags).toEqual(['divan', 'mebel']);
    const note = await c.post(`/v1/admin/customers/${ids.A}/notes`, {
      text: 'Qo‘ng‘iroq qildi, divan rangi so‘radi',
    });
    expect(note.status).toBe(201);
    const audits = await prisma.auditLog.findMany({ where: { entityId: ids.A } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['customer.tags_update', 'customer.note_added']),
    );
    expect(JSON.stringify(audits)).not.toContain('divan rangi');
    const detail = (await c.get(`/v1/admin/customers/${ids.A}`)).body as CustomerDetailDto;
    expect(detail.tags).toEqual(['divan', 'mebel']);
    expect(detail.notes[0]!.text).toContain('divan rangi');
  });

  it('CSV export: masked unless revealed, audited; JSON data export for one customer', async () => {
    const owner = clients.get('OWNER')!;
    const masked = await owner.post('/v1/admin/customers/export', { q: tag, segment: 'loyal' });
    expect(masked.status).toBe(200);
    expect(masked.headers['content-type']).toMatch(/text\/csv/);
    const text = masked.text;
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3); // header + B + C
    expect(text).not.toContain(phones.B);
    expect(text).toContain('*** **');
    const full = await owner.post('/v1/admin/customers/export', { q: tag, reveal: true });
    // Digits without '+': no formula-guard apostrophe in Excel/CRM imports.
    expect(full.text).toContain(`,${phones.B!.slice(1)},`);
    expect(full.text).not.toContain(`'+998`);
    expect(masked.text).not.toContain(`'+998`);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'customer.export' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    expect(audits.map((a) => (a.after as { revealed: boolean }).revealed)).toEqual([true, false]);

    const one = await owner.post(`/v1/admin/customers/${ids.B}/export`);
    expect(one.status).toBe(200);
    expect(one.body.profile.publicId).toMatch(/^C-/);
    expect(one.body.orders).toHaveLength(2);
  });

  it('erase: refuses open orders and wrong confirmation, scrubs PII, keeps orders', async () => {
    const owner = clients.get('OWNER')!;
    const g = await prisma.customer.findUniqueOrThrow({ where: { id: ids.G } });
    const open = await owner.post(`/v1/admin/customers/${ids.G}/erase`, { confirm: g.publicId });
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe('CUSTOMER_HAS_OPEN_ORDERS');

    const b = await prisma.customer.findUniqueOrThrow({ where: { id: ids.B } });
    const wrong = await owner.post(`/v1/admin/customers/${ids.B}/erase`, { confirm: 'C-1' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('ADMIN_CONFIRM_MISMATCH');

    // Identifying data beyond the profile: review photos, staff notes, Telegram chat, MoySklad copy.
    const bOrders = await prisma.order.findMany({
      where: { customerId: ids.B },
      select: { id: true },
    });
    const photo = await prisma.file.create({
      data: { key: `reviews/test-${run}/a.jpg`, mime: 'image/jpeg', size: 10 },
    });
    const review = await prisma.review.create({
      data: {
        productId: variant.productId,
        customerId: ids.B!,
        orderId: bOrders[0]!.id,
        rating: 5,
        text: 'Zo‘r',
        locale: 'uz',
        source: 'web',
        status: 'APPROVED',
        photoFileIds: [photo.id],
        beforeFileId: photo.id,
        photoConsent: true,
        inGallery: true,
        gallerySort: 1,
      },
    });
    const note = await prisma.orderEvent.create({
      data: {
        orderId: bOrders[0]!.id,
        type: 'NOTE',
        actorType: 'STAFF',
        data: { text: 'Mijoz Dilnoza, uyi Chilonzorda' },
      },
    });
    const chat = await prisma.conversation.create({
      data: { customerId: ids.B!, telegramChatId: 777000111n, topic: 'advice' },
    });
    const counterpartyId = `cp-${run}`;
    await prisma.moyskladOrderLink.create({
      data: { orderId: bOrders[0]!.id, externalId: `ms-${run}`, counterpartyId },
    });

    const ok = await owner.post(`/v1/admin/customers/${ids.B}/erase`, { confirm: b.publicId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.ordersKept).toBe(2);
    expect(ok.body.photosRemoved).toBe(1);
    expect(ok.body.external).toEqual([{ system: 'moysklad', counterpartyId }]);
    const reviewAfter = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(reviewAfter).toMatchObject({
      photoFileIds: [],
      beforeFileId: null,
      inGallery: false,
      photoConsent: false,
      rating: 5,
    });
    expect(await prisma.file.findUnique({ where: { id: photo.id } })).toBeNull();
    const noteAfter = await prisma.orderEvent.findUniqueOrThrow({ where: { id: note.id } });
    expect(noteAfter.data).toEqual({ text: '—' });
    const chatAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } });
    expect(chatAfter.telegramChatId).toBe(0n);
    // Shared DB: an approved review on a seeded product would show up in other suites' ratings.
    await prisma.review.delete({ where: { id: review.id } });
    await prisma.conversation.delete({ where: { id: chat.id } });

    const after = await prisma.customer.findUniqueOrThrow({
      where: { id: ids.B },
      include: { addresses: true, orders: { include: { payments: true } }, consents: true },
    });
    expect(after).toMatchObject({ phone: null, name: null, tags: [] });
    expect(after.deletedAt).not.toBeNull();
    expect(after.addresses).toHaveLength(0);
    expect(after.orders).toHaveLength(2);
    for (const o of after.orders) {
      expect(o.contactPhone).toBe('');
      expect(JSON.stringify(o.address)).not.toContain('Amir Temur');
      expect(o.totalTiyin).toBe(30_000_000n);
      expect(o.payments[0]!.status).toBe('PAID');
    }
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'customer.erase', entityId: ids.B },
    });
    expect((audit.after as { external: unknown }).external).toEqual([
      { system: 'moysklad', counterpartyId },
    ]);
    expect(JSON.stringify(audit)).not.toContain(phones.B);

    expect(names((await list(`q=${tag}`)).items)).not.toContain('B');
    const again = await owner.post(`/v1/admin/customers/${ids.B}/erase`, { confirm: b.publicId });
    expect(again.body.error.code).toBe('CUSTOMER_ERASED');
    const detail = (await owner.get(`/v1/admin/customers/${ids.B}`)).body as CustomerDetailDto;
    expect(detail.erasedAt).not.toBeNull();
    expect(detail.kpis.purchases).toBe(2);
    expect(detail.external).toEqual([{ system: 'moysklad', counterpartyId }]);
  });
});
