import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AdminSegmentDto,
  type AdminSegmentListDto,
  type AdminSegmentMembersDto,
  type AudienceRules,
  type AudienceSizeDto,
  audienceRulesSchema,
  STAFF_ROLES,
  type StaffRole,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AD_SIGNALS_CURSOR, AdSignalsService } from '../src/audiences/ad-signals.service';
import { AdsProvidersService } from '../src/audiences/ads-providers.service';
import { AudienceService } from '../src/audiences/audience.service';
import { AudienceJobs } from '../src/audiences/audiences.module';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { hashPhone } from '../src/integrations/providers/ads/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

const DAY = 86_400_000;
const tag = `aud${randomBytes(3).toString('hex')}`;
const phone = () => `+99893${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const b64 = (rules: unknown) => Buffer.from(JSON.stringify(rules)).toString('base64url');
const AD_KEYS = ['meta_capi', 'tiktok_pixel'] as const;

describe('audiences A8 + ad signals (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: AdminClient;
  let ownerId: string;
  const clients = new Map<StaffRole, AdminClient>();
  const ids: Record<string, string> = {};
  const phones: Record<string, string> = {};
  const eventIds: string[] = [];
  const visitorIds: string[] = [];
  const sessionIds: string[] = [];
  const segmentIds: string[] = [];
  const startedAt = new Date();
  let variant: { id: string; productId: string };
  let cursorBefore: { ts: Date; ref: string } | null = null;

  async function customer(key: string, data: Partial<Prisma.CustomerCreateInput> = {}) {
    const p = phone();
    const c = await prisma.customer.create({ data: { phone: p, name: `${tag} ${key}`, ...data } });
    ids[key] = c.id;
    phones[key] = p;
    return c.id;
  }

  async function consent(customerId: string, granted: boolean, at = new Date()) {
    await prisma.consent.create({
      data: { customerId, channel: 'ADS_MATCHING', granted, source: 'test', createdAt: at },
    });
  }

  async function event(
    name: string,
    at: Date,
    who: {
      customerId?: string;
      anonymousId?: string;
      sessionId?: string;
      path?: string;
      props?: object;
    },
  ) {
    const id = randomUUID();
    eventIds.push(id);
    await prisma.event.create({
      data: {
        id,
        ts: at,
        name,
        sessionId: who.sessionId ?? randomUUID(),
        anonymousId: who.anonymousId ?? randomUUID(),
        customerId: who.customerId ?? null,
        path: who.path ?? '/uz/p/test',
        props: who.props ?? {},
      },
    });
    return id;
  }

  async function order(
    customerId: string,
    opts: { soum: number; at: Date; paid?: boolean; status?: string; cod?: boolean },
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
        address: { region: 'tashkent_city' },
        subtotalTiyin: tiyin,
        totalTiyin: tiyin,
        paymentMethod: opts.cod ? 'COD' : 'PAYME',
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
    if (opts.paid)
      await prisma.payment.create({
        data: { orderId: o.id, method: 'PAYME', status: 'PAID', amountTiyin: tiyin },
      });
  }

  const preview = async (rules: unknown) => {
    const res = await owner.get(`/v1/admin/audiences/preview?rules=${b64(rules)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as AudienceSizeDto;
  };

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    for (const role of STAFF_ROLES) {
      const s = await signedIn(app, role);
      clients.set(role, s.client);
      if (role === 'OWNER') ownerId = s.id;
    }
    owner = clients.get('OWNER')!;
    variant = await prisma.variant.findFirstOrThrow({ select: { id: true, productId: true } });
    const now = Date.now();

    // A: added to cart 2 days ago (through a linked visitor), no order, ads consent.
    const a = await customer('A', { tags: [tag], telegramId: BigInt(now) });
    const anonA = randomUUID();
    visitorIds.push(anonA);
    await prisma.visitor.create({ data: { anonymousId: anonA, customerId: a } });
    await event('add_to_cart', new Date(now - 2 * DAY), { anonymousId: anonA });
    await consent(a, true);
    // B: added to cart 3 days ago (stamped) but bought yesterday; consent granted then withdrawn.
    const b = await customer('B', { tags: [tag] });
    await event('add_to_cart', new Date(now - 3 * DAY), { customerId: b });
    await order(b, { soum: 300_000, at: new Date(now - DAY), paid: true });
    await consent(b, true, new Date(now - 2 * DAY));
    await consent(b, false, new Date(now - DAY));
    // C: added to cart 10 days ago (outside 7 d), no consent.
    const c = await customer('C', { tags: [tag] });
    await event('add_to_cart', new Date(now - 10 * DAY), { customerId: c });
    // D: VIP via a confirmed COD order 70 days ago (inactive 60 d+), ads consent.
    const d = await customer('D');
    await order(d, {
      soum: 2_500_000,
      at: new Date(now - 70 * DAY),
      status: 'CONFIRMED',
      cod: true,
    });
    await consent(d, true);
    // E: lead without purchase.
    await customer('E', { leadAt: new Date(now - 5 * DAY), leadSource: 'popup' });
    // F: 40 s on the sofa kit page (next page_view), no purchase.
    const f = await customer('F');
    const anonF = randomUUID();
    const sid = randomUUID();
    visitorIds.push(anonF);
    sessionIds.push(sid);
    await prisma.visitor.create({ data: { anonymousId: anonF, customerId: f } });
    const t0 = new Date(now - DAY);
    await prisma.session.create({
      data: {
        id: sid,
        anonymousId: anonF,
        startedAt: t0,
        endedAt: new Date(t0.getTime() + 60_000),
        landingPath: '/uz/p/divan-yangilash-toplami',
        channel: 'direct',
        device: 'mobile',
      },
    });
    await event('page_view', t0, {
      anonymousId: anonF,
      sessionId: sid,
      path: '/uz/p/divan-yangilash-toplami',
    });
    await event('page_view', new Date(t0.getTime() + 40_000), {
      anonymousId: anonF,
      sessionId: sid,
      path: '/uz/katalog',
    });
    // G: erased customer with a cart event — never a member.
    const g = await customer('G', { deletedAt: new Date() });
    await event('add_to_cart', new Date(now - DAY), { customerId: g });

    cursorBefore = await prisma.jobCursor.findUnique({ where: { key: AD_SIGNALS_CURSOR } });
  });

  afterAll(async () => {
    const custIds = Object.values(ids);
    await prisma.adSignal.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.segment.deleteMany({ where: { id: { in: segmentIds } } });
    await prisma.segmentMember.deleteMany({ where: { customerId: { in: custIds } } });
    await prisma.$executeRaw`DELETE FROM "Event" WHERE id = ANY(${eventIds})`;
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.visitor.deleteMany({ where: { anonymousId: { in: visitorIds } } });
    const orders = await prisma.order.findMany({
      where: { customerId: { in: custIds } },
      select: { id: true },
    });
    await prisma.payment.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
    for (const key of AD_KEYS)
      await prisma.integration.updateMany({
        where: { key },
        data: { status: 'DISCONNECTED', credentials: null, lastError: null },
      });
    await prisma.integrationLog.deleteMany({
      where: { integrationKey: { in: [...AD_KEYS] }, createdAt: { gte: startedAt } },
    });
    if (cursorBefore)
      await prisma.jobCursor.update({ where: { key: AD_SIGNALS_CURSOR }, data: cursorBefore });
    else await prisma.jobCursor.deleteMany({ where: { key: AD_SIGNALS_CURSOR } });
    await app.close();
  });

  it('RBAC: audiences.edit (Owner, Manager, Marketer) only', async () => {
    const expected: Record<StaffRole, number> = {
      OWNER: 200,
      MANAGER: 200,
      MARKETER: 200,
      OPERATOR: 403,
      WAREHOUSE: 403,
    };
    for (const role of STAFF_ROLES)
      expect((await clients.get(role)!.get('/v1/admin/audiences')).status, role).toBe(
        expected[role],
      );
  });

  it('lists the seeded presets with empty destinations and Phase 5 auto messages off', async () => {
    const res = await owner.get('/v1/admin/audiences');
    const body = res.body as AdminSegmentListDto;
    const keys = body.items.map((s) => s.key).filter(Boolean);
    expect(keys).toEqual(
      expect.arrayContaining([
        'abandoned_cart_7d',
        'sofa_kit_viewers',
        'leads_no_purchase',
        'fabric_spray_upsell',
        'vip',
        'inactive_60d',
      ]),
    );
    for (const s of body.items.filter((x) => x.key)) {
      expect(s.destinations).toEqual([]);
      expect(s.autoMessage).toBeNull();
    }
    expect(body.signals.map((s) => s.platform)).toEqual(['meta', 'google', 'tiktok']);
  });

  /** Independent SQL for each preset (the acceptance check "preview equals SQL"). */
  const HAND_SQL: Record<string, (rules: AudienceRules) => Prisma.Sql> = {
    abandoned_cart_7d: () => Prisma.sql`
      SELECT c.id FROM "Customer" c WHERE c."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "Event" e LEFT JOIN "Visitor" v ON v."anonymousId" = e."anonymousId"
                    WHERE e.name = 'add_to_cart' AND e.ts >= now() - interval '7 days'
                      AND (e."customerId" = c.id OR v."customerId" = c.id))
        AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id
                    AND o."createdAt" >= now() - interval '7 days' AND o.status NOT IN ('CANCELLED', 'RETURNED')
                    AND (EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID', 'PARTIALLY_REFUNDED'))
                         OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED'))))`,
    leads_no_purchase: () => Prisma.sql`
      SELECT c.id FROM "Customer" c WHERE c."deletedAt" IS NULL AND c."leadAt" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status NOT IN ('CANCELLED', 'RETURNED')
          AND (EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID', 'PARTIALLY_REFUNDED'))
               OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED'))))`,
    vip: () => Prisma.sql`
      WITH purchases AS (
        SELECT o."customerId" AS cid, o."totalTiyin" - COALESCE((SELECT SUM(r."amountTiyin") FROM "Refund" r
          JOIN "Payment" p ON p.id = r."paymentId" WHERE p."orderId" = o.id), 0) AS net
        FROM "Order" o WHERE o.status NOT IN ('CANCELLED', 'RETURNED')
          AND (EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID', 'PARTIALLY_REFUNDED'))
               OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED'))))
      SELECT c.id FROM "Customer" c JOIN purchases pu ON pu.cid = c.id
      WHERE c."deletedAt" IS NULL GROUP BY c.id HAVING SUM(pu.net) >= 200000000`,
    inactive_60d: () => Prisma.sql`
      SELECT c.id FROM "Customer" c JOIN "Order" o ON o."customerId" = c.id
      WHERE c."deletedAt" IS NULL AND o.status NOT IN ('CANCELLED', 'RETURNED')
        AND (EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID', 'PARTIALLY_REFUNDED'))
             OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED')))
      GROUP BY c.id HAVING MAX(o."createdAt") < now() - interval '60 days'`,
    sofa_kit_viewers: (rules) => {
      const cond = rules.groups[0]!.conditions[1] as { productId: string };
      return Prisma.sql`
        WITH pv AS (
          SELECT COALESCE(e."customerId", v."customerId") AS cid, e.path, e.ts,
                 LEAD(e.ts) OVER (PARTITION BY e."sessionId" ORDER BY e.ts) AS next_ts, s."endedAt"
          FROM "Event" e LEFT JOIN "Visitor" v ON v."anonymousId" = e."anonymousId"
          LEFT JOIN "Session" s ON s.id = e."sessionId"
          WHERE e.name = 'page_view' AND e.ts >= now() - interval '30 days')
        SELECT c.id FROM "Customer" c WHERE c."deletedAt" IS NULL
          AND (SELECT COALESCE(SUM(LEAST(GREATEST(EXTRACT(EPOCH FROM COALESCE(pv.next_ts, pv."endedAt") - pv.ts), 0), 1800)), 0)
               FROM pv WHERE pv.cid = c.id
                 AND pv.path IN ('/p/divan-yangilash-toplami', '/uz/p/divan-yangilash-toplami', '/ru/p/divan-yangilash-toplami')) >= 30
          AND NOT EXISTS (SELECT 1 FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
                          JOIN "Variant" va ON va.id = oi."variantId"
                          WHERE o."customerId" = c.id AND va."productId" = ${cond.productId}
                            AND o.status NOT IN ('CANCELLED', 'RETURNED')
                            AND (EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID', 'PARTIALLY_REFUNDED'))
                                 OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED'))))`;
    },
  };

  it('audience size preview equals hand-written SQL for the presets (and the compiled member list)', async () => {
    const audiences = app.get(AudienceService);
    for (const [key, hand] of Object.entries(HAND_SQL)) {
      const seg = await prisma.segment.findUniqueOrThrow({ where: { key } });
      const rules = audienceRulesSchema.parse(seg.rules);
      const expected = (await prisma.$queryRaw<{ id: string }[]>(hand(rules)))
        .map((r) => r.id)
        .sort();
      const members = (await audiences.memberIds(rules)).sort();
      expect(members, key).toEqual(expected);
      expect((await preview(rules)).total, key).toBe(expected.length);
    }
    const inPreset = async (key: string) =>
      new Set(
        await audiences.memberIds(
          audienceRulesSchema.parse(
            (await prisma.segment.findUniqueOrThrow({ where: { key } })).rules,
          ),
        ),
      );
    const abandoned = await inPreset('abandoned_cart_7d');
    expect([
      abandoned.has(ids.A!),
      abandoned.has(ids.B!),
      abandoned.has(ids.C!),
      abandoned.has(ids.G!),
    ]).toEqual([true, false, false, false]);
    expect((await inPreset('vip')).has(ids.D!)).toBe(true);
    expect((await inPreset('inactive_60d')).has(ids.D!)).toBe(true);
    expect((await inPreset('leads_no_purchase')).has(ids.E!)).toBe(true);
    expect((await inPreset('sofa_kit_viewers')).has(ids.F!)).toBe(true);
  });

  it('preview counts phone / Telegram / ads-ready members', async () => {
    const size = await preview({ groups: [{ conditions: [{ type: 'tag', tag, has: true }] }] });
    // A (Telegram, ads consent), B (consent withdrawn), C (no consent).
    expect(size).toEqual({ total: 3, withPhone: 3, withTelegram: 1, adsReady: 1 });
  });

  it('rejects rules with an unknown product and invalid rules', async () => {
    const res = await owner.get(
      `/v1/admin/audiences/preview?rules=${b64({ groups: [{ conditions: [{ type: 'product', productId: 'nope', bought: true }] }] })}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUDIENCE_PRODUCT_NOT_FOUND');
    const bad = await owner.get(
      `/v1/admin/audiences/preview?rules=${b64({ groups: [{ conditions: [{ type: 'sql' }] }] })}`,
    );
    expect(bad.status).toBe(400);
  });

  it('create (audited) → refresh stores the diff → destinations get only consenting hashes', async () => {
    for (const key of AD_KEYS)
      await app
        .get(IntegrationsService)
        .connect(
          key,
          key === 'meta_capi'
            ? { pixelId: '1', accessToken: `t-${randomBytes(4).toString('hex')}`, adAccountId: '2' }
            : { pixelId: '1', accessToken: `t-${randomBytes(4).toString('hex')}` },
          ownerId,
          null,
        );
    const fakes = app.get(AdsProvidersService).fakes;
    fakes.reset();
    const created = await owner.post('/v1/admin/audiences', {
      name: `${tag} segment`,
      rules: { groups: [{ conditions: [{ type: 'tag', tag, has: true }] }] },
      destinations: ['meta', 'tiktok', 'sms'],
      autoMessage: {
        enabled: true,
        steps: [{ channel: 'sms', delayMinutes: 120, templateKey: 'otp' }],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const seg = created.body as AdminSegmentDto;
    segmentIds.push(seg.id);
    expect(
      await prisma.auditLog.count({ where: { action: 'segment.create', entityId: seg.id } }),
    ).toBe(1);

    const jobs = app.get(AudienceJobs);
    await jobs.segment(seg.id);
    let row = await prisma.segment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.size).toBe(3);

    // B leaves, D joins.
    await prisma.customer.update({ where: { id: ids.B! }, data: { tags: [] } });
    await prisma.customer.update({ where: { id: ids.D! }, data: { tags: [tag] } });
    await jobs.segment(seg.id);
    row = await prisma.segment.findUniqueOrThrow({ where: { id: seg.id } });
    expect([row.size, row.lastAdded, row.lastRemoved]).toEqual([3, 1, 1]);
    const leftB = await prisma.segmentMember.findUniqueOrThrow({
      where: { segmentId_customerId: { segmentId: seg.id, customerId: ids.B! } },
    });
    expect(leftB.removedAt).not.toBeNull();

    // Meta holds A and D (consenting) as digits-only hashes; TikTok is below its 1 000 minimum.
    const meta = [...(fakes.audiences.get('meta')?.values() ?? [])];
    expect(meta).toHaveLength(1);
    expect([...meta[0]!].sort()).toEqual(
      [hashPhone(phones.A!, 'meta'), hashPhone(phones.D!, 'meta')].sort(),
    );
    expect(fakes.audiences.get('tiktok')).toBeUndefined();
    const detail = (await owner.get(`/v1/admin/audiences/${seg.id}`)).body as AdminSegmentDto;
    const state = (d: string) => detail.destinationStates.find((s) => s.destination === d)!;
    expect(state('meta')).toMatchObject({
      enabled: true,
      status: 'ok',
      members: 2,
      connected: true,
    });
    expect(state('tiktok')).toMatchObject({ status: 'too_small', members: 0 });
    expect(state('google')).toMatchObject({ enabled: false, status: 'off', connected: false });
    expect(detail.autoMessage).toEqual({
      enabled: true,
      steps: [{ channel: 'sms', delayMinutes: 120, templateKey: 'otp' }],
    });

    // Consent withdrawal removes A from the platform on the next sync.
    await consent(ids.A!, false);
    await jobs.segment(seg.id);
    expect([...meta[0]!]).toEqual([hashPhone(phones.D!, 'meta')]);

    // Members are listed masked only.
    const members = (await owner.get(`/v1/admin/audiences/${seg.id}/members`))
      .body as AdminSegmentMembersDto;
    expect(members.items).toHaveLength(3);
    expect(JSON.stringify(members)).not.toContain(phones.A!.slice(4));
    expect(members.items.every((m) => m.phoneMasked?.includes('***'))).toBe(true);

    // Turning the destination off empties what was uploaded.
    const patched = await owner.send('patch', `/v1/admin/audiences/${seg.id}`, {
      destinations: [],
    });
    expect(patched.status).toBe(200);
    await jobs.segment(seg.id);
    expect(meta[0]!.size).toBe(0);
    expect(await prisma.segmentDestinationMember.count({ where: { segmentId: seg.id } })).toBe(0);
    const logs = await prisma.integrationLog.count({
      where: { integrationKey: 'meta_capi', kind: 'audience.sync', createdAt: { gte: startedAt } },
    });
    expect(logs).toBeGreaterThan(0);
  });

  it('30-day result counts purchases made after joining', async () => {
    const seg = segmentIds[0]!;
    await order(ids.A!, { soum: 100_000, at: new Date(), paid: true });
    const detail = (await owner.get(`/v1/admin/audiences/${seg}`)).body as AdminSegmentDto;
    // Members in the window: A, B (left), C, D; converted: A (B's purchase predates joining).
    expect(detail.result).toMatchObject({
      members: 4,
      converted: 1,
      crPct: 25,
      revenueSoum: 100_000,
    });
  });

  it('ad signals: consenting customers only, one row per platform + event, sent once', async () => {
    const signals = app.get(AdSignalsService);
    const fakes = app.get(AdsProvidersService).fakes;
    fakes.reset();
    const now = Date.now();
    await prisma.jobCursor.upsert({
      where: { key: AD_SIGNALS_CURSOR },
      create: { key: AD_SIGNALS_CURSOR, ts: new Date(now - 30 * 60_000), ref: '' },
      update: { ts: new Date(now - 30 * 60_000), ref: '' },
    });
    await consent(ids.A!, true);
    const anonD = randomUUID();
    visitorIds.push(anonD);
    await prisma.visitor.create({ data: { anonymousId: anonD, customerId: ids.D! } });
    const at = new Date(now - 10 * 60_000);
    const eA = await event('add_to_cart', at, {
      customerId: ids.A!,
      props: { variantId: 'v', qty: 2, priceSoum: 1000 },
    });
    const eD = await event('lead', at, { anonymousId: anonD, props: { source: 'popup' } });
    const eC = await event('begin_checkout', at, {
      customerId: ids.C!,
      props: { itemsCount: 1, valueSoum: 5 },
    });
    const eAnon = await event('add_to_cart', at, {});
    const eView = await event('view_item', at, { customerId: ids.A! });

    await signals.collect();
    await signals.collect();
    const rows = await prisma.adSignal.findMany({
      where: { eventId: { in: [eA, eD, eC, eAnon, eView] } },
    });
    expect(
      rows
        .map((r) => `${r.platform}:${r.eventId === eA ? 'A' : r.eventId === eD ? 'D' : '?'}`)
        .sort(),
    ).toEqual(['meta:A', 'meta:D', 'tiktok:A', 'tiktok:D']);

    await signals.send();
    await signals.send();
    const sent = await prisma.adSignal.findMany({ where: { eventId: { in: [eA, eD] } } });
    expect(sent.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
    const metaEvents = fakes.events.get('meta')!;
    expect(metaEvents.get(eA)).toMatchObject({
      name: 'add_to_cart',
      valueSoum: 2000,
      phone: phones.A,
    });
    expect(metaEvents.get(eD)).toMatchObject({ name: 'lead', customerId: ids.D });
    expect(fakes.calls.filter((c) => c.op === 'send').reduce((n, c) => n + c.count, 0)).toBe(4);

    // A platform rejection backs off; consent withdrawn before sending skips the row.
    const eA2 = await event('purchase', at, {
      customerId: ids.A!,
      props: { valueTiyin: '50000000', orderNumber: 'F-1' },
    });
    const eD2 = await event('add_to_cart', at, { customerId: ids.D! });
    await prisma.jobCursor.update({
      where: { key: AD_SIGNALS_CURSOR },
      data: { ts: new Date(now - 30 * 60_000), ref: '' },
    });
    fakes.rejectEvents.add(eA2);
    await signals.collect();
    await consent(ids.D!, false);
    await signals.send();
    const a2 = await prisma.adSignal.findFirstOrThrow({
      where: { eventId: eA2, platform: 'meta' },
    });
    expect(a2).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(a2.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    const d2 = await prisma.adSignal.findFirstOrThrow({
      where: { eventId: eD2, platform: 'meta' },
    });
    expect(d2).toMatchObject({ status: 'SKIPPED', lastError: 'ads consent withdrawn' });
    expect(fakes.events.get('meta')!.has(eD2)).toBe(false);
  });
});
