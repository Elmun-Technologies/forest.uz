import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AdSpendImportResultDto,
  type CohortsDto,
  type CustomerJourneyDto,
  type DashboardDto,
  type DevicesDto,
  type EventsDto,
  type FunnelDto,
  type OrderJourneyDto,
  type PagesDto,
  type RealtimeDto,
  type SourcesDto,
  type StaffRole,
  tashkentDayKeyStart,
  toTashkentParts,
} from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { FakeAdSpendSource } from '../src/admin/analytics/ad-spend-source';
import { RT_SESSIONS, rtSessionKey } from '../src/admin/analytics/realtime.service';
import { ReportsService } from '../src/admin/analytics/reports.service';
import { AttributionService } from '../src/attribution/attribution.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

/**
 * Phase 4 acceptance (A1/A2): a known world of sessions, events, orders and ad spend in a month
 * nobody else writes to (two months ahead — inside the Event partitions `ensure_event_partitions`
 * keeps), with a fixed period (`end`). Every expected number below is computed by hand from the
 * seed, independently of the SQL under test.
 */
const H = 3_600_000;
const run = randomBytes(3).toString('hex');

const nowParts = toTashkentParts(new Date());
const mIndex = nowParts.year * 12 + nowParts.month - 1 + 2;
const Y = Math.floor(mIndex / 12);
const MM = String((mIndex % 12) + 1).padStart(2, '0');
const nextIndex = mIndex + 1;
const NEXT = `${Math.floor(nextIndex / 12)}-${String((nextIndex % 12) + 1).padStart(2, '0')}`;
const day = (d: number) => `${Y}-${MM}-${String(d).padStart(2, '0')}`;
/** Tashkent wall clock: day `d` of the test month at `h` o'clock. */
const at = (d: number, h: number) => new Date(tashkentDayKeyStart(day(d)).getTime() + h * H);
const END = day(14); // current period = days 8..14, previous = days 1..7
const Q = `days=7&end=${END}`;

type SessionSeed = {
  key: string;
  anon: string;
  customer?: string;
  d: number;
  h: number;
  channel: string;
  device: 'mobile' | 'desktop' | 'tablet';
  utm?: Record<string, string>;
  referrer?: string;
  bounced: boolean;
  duration: number;
  landing: string;
  exit: string;
  region: string;
  events: string[];
  /** Seconds after the start of each event (default: 0, 1, 2…). */
  offsets?: number[];
};

const SESSIONS: SessionSeed[] = [
  // c1's journey: paid instagram → telegram post → direct (buys o1)
  {
    key: 's1',
    anon: 'a1',
    d: 8,
    h: 10,
    channel: 'paid_meta',
    device: 'mobile',
    utm: { source: 'instagram', medium: 'cpc', campaign: 'divan_reels' },
    bounced: false,
    duration: 120,
    landing: '/uz',
    exit: '/uz/p/chalk-white',
    region: 'Toshkent',
    events: ['page_view', 'page_view', 'view_item'],
  },
  {
    key: 's2',
    anon: 'a1',
    d: 9,
    h: 20,
    channel: 'telegram',
    device: 'mobile',
    utm: { source: 'telegram', medium: 'social', campaign: 'kanal_post' },
    bounced: true,
    duration: 0,
    landing: '/uz/katalog',
    exit: '/uz/katalog',
    region: 'Toshkent',
    events: ['page_view'],
  },
  {
    key: 's3',
    anon: 'a1',
    d: 10,
    h: 11,
    channel: 'direct',
    device: 'mobile',
    bounced: false,
    duration: 300,
    landing: '/uz',
    exit: '/uz/savat',
    region: 'Toshkent',
    events: [
      'page_view',
      'view_item',
      'selector_used',
      'add_to_cart',
      'begin_checkout',
      'page_view',
    ],
  },
  // c2: organic google → buys o2 (COD confirmed)
  {
    key: 's4',
    anon: 'a2',
    customer: 'c2',
    d: 11,
    h: 9,
    channel: 'organic_search',
    device: 'mobile',
    referrer: 'https://www.google.com/',
    bounced: false,
    duration: 200,
    landing: '/uz/p/chalk-white',
    exit: '/uz/savat',
    region: 'Samarqand',
    events: ['page_view', 'view_item', 'add_to_cart', 'begin_checkout'],
  },
  // traffic without purchases
  {
    key: 's6',
    anon: 'a3',
    d: 12,
    h: 15,
    channel: 'paid_meta',
    device: 'mobile',
    utm: { source: 'facebook', medium: 'cpc', campaign: 'DIVAN_REELS' },
    bounced: true,
    duration: 0,
    landing: '/uz',
    exit: '/uz',
    region: 'Toshkent',
    events: ['page_view'],
  },
  {
    key: 's7',
    anon: 'a4',
    d: 13,
    h: 18,
    channel: 'direct',
    device: 'desktop',
    bounced: true,
    duration: 0,
    landing: '/uz/katalog',
    exit: '/uz/katalog',
    region: 'Buxoro',
    events: ['page_view'],
  },
  {
    key: 's8',
    anon: 'a5',
    // Starts 23:45 on the period's last day; everything after the page view happens after
    // midnight — still this session's journey (funnel/goals/leads count it).
    d: 14,
    h: 23.75,
    channel: 'referral',
    device: 'tablet',
    referrer: 'https://example.uz/post',
    bounced: false,
    duration: 1220,
    offsets: [0, 1200, 1210, 1220],
    landing: '/uz/p/chalk-white',
    exit: '/uz/p/chalk-white',
    region: 'Toshkent',
    events: ['page_view', 'view_item', 'selector_used', 'lead'],
  },
  // previous period: c6 direct → buys o6 (anonymous session, found through Order.sessionId)
  {
    key: 's5',
    anon: 'a6',
    d: 3,
    h: 12,
    channel: 'direct',
    device: 'desktop',
    bounced: false,
    duration: 60,
    landing: '/uz',
    exit: '/uz/savat',
    region: 'Toshkent',
    events: ['page_view', 'add_to_cart'],
  },
  // previous period, shared phone: c5 signed in on c1's device (visitor a1 → c1, latest wins).
  // Never part of c1's journey or attribution.
  {
    key: 's10',
    anon: 'a1',
    customer: 'c5',
    d: 5,
    h: 12,
    channel: 'paid_google',
    device: 'desktop',
    utm: { source: 'google', medium: 'cpc', campaign: 'brand' },
    bounced: true,
    duration: 0,
    landing: '/uz',
    exit: '/uz',
    region: 'Toshkent',
    events: ['page_view'],
  },
];

describe('admin analytics A1/A2 + attribution (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const clients = new Map<StaffRole, AdminClient>();
  const sid = new Map<string, string>();
  const cid = new Map<string, string>();
  const oid = new Map<string, string>();
  const onum = new Map<string, string>();
  const eventIds: string[] = [];
  const liveIds = [randomUUID(), randomUUID(), randomUUID()];
  const staleId = randomUUID();
  let variant: { id: string; productId: string };
  let sellerId = '';

  const get = async <T>(path: string, role: StaffRole = 'OWNER') => {
    const res = await clients.get(role)!.get(`/v1/admin${path}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as T;
  };

  async function order(
    key: string,
    customer: string,
    o: {
      soum: number;
      at: Date;
      status?: string;
      method?: 'PAYME' | 'CLICK' | 'COD';
      payment?: 'PAID' | 'PENDING' | 'COD_PENDING' | 'PARTIALLY_REFUNDED';
      refundSoum?: number;
      session?: string;
      source?: string;
    },
  ) {
    const tiyin = BigInt(o.soum) * 100n;
    const row = await prisma.order.create({
      data: {
        publicId: randomBytes(8).toString('hex'),
        trackingToken: randomBytes(8).toString('hex'),
        customerId: cid.get(customer)!,
        status: (o.status ?? 'DELIVERED') as 'DELIVERED',
        contactName: `${run} ${customer}`,
        contactPhone: '+998971112233',
        address: { region: 'tashkent_city', district: null, line: 'Test 1' },
        subtotalTiyin: tiyin,
        totalTiyin: tiyin,
        paymentMethod: o.method ?? 'PAYME',
        deliveryZone: 'tashkent-city-yandex',
        carrier: 'YANDEX',
        offerVersion: 'test',
        source: o.source ?? 'web',
        sessionId: o.session ? sid.get(o.session)! : null,
        createdAt: o.at,
        items: {
          create: {
            variantId: variant.id,
            sellerId,
            nameSnapshot: { uz: 'Test', ru: 'Test' },
            sku: 'T',
            ikpu: '00000000000000000',
            vatPercent: 12,
            qty: 2,
            priceTiyin: tiyin / 2n,
          },
        },
      },
    });
    oid.set(key, row.id);
    onum.set(key, row.number);
    if (o.payment) {
      const pay = await prisma.payment.create({
        data: {
          orderId: row.id,
          method: o.method ?? 'PAYME',
          status: o.payment,
          amountTiyin: tiyin,
        },
      });
      if (o.refundSoum)
        await prisma.refund.create({
          data: {
            paymentId: pay.id,
            amountTiyin: BigInt(o.refundSoum) * 100n,
            reason: 'test',
            staffId: 'test',
          },
        });
    }
  }

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    for (const role of ['OWNER', 'OPERATOR', 'MARKETER'] as const)
      clients.set(role, (await signedIn(app, role)).client);
    variant = await prisma.variant.findFirstOrThrow({
      where: { product: { status: 'ACTIVE' } },
      select: { id: true, productId: true },
    });
    sellerId = (await prisma.seller.findFirstOrThrow()).id;

    for (const k of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
      const c = await prisma.customer.create({
        data: {
          name: `${run} ${k}`,
          // Leads: c2 and c3 in the current period, c6 in the previous one.
          leadAt: k === 'c2' ? at(11, 9) : k === 'c3' ? at(12, 10) : k === 'c6' ? at(3, 12) : null,
          leadSource: k === 'c2' || k === 'c3' || k === 'c6' ? 'popup' : null,
        },
      });
      cid.set(k, c.id);
    }
    const anons = [...new Set(SESSIONS.map((s) => s.anon))];
    for (const a of anons)
      await prisma.visitor.create({
        data: {
          anonymousId: `${run}-${a}`,
          // a1 is linked only through the visitor (identity stitching), not on its sessions.
          customerId: a === 'a1' ? cid.get('c1')! : null,
        },
      });
    for (const s of SESSIONS) {
      const id = randomUUID();
      sid.set(s.key, id);
      const startedAt = at(s.d, s.h);
      await prisma.session.create({
        data: {
          id,
          anonymousId: `${run}-${s.anon}`,
          customerId: s.customer ? cid.get(s.customer)! : null,
          startedAt,
          endedAt: new Date(startedAt.getTime() + s.duration * 1000),
          landingPath: s.landing,
          exitPath: s.exit,
          pageviews: s.events.filter((e) => e === 'page_view').length,
          events: s.events.length,
          durationSec: s.duration,
          bounced: s.bounced,
          utm: s.utm ?? undefined,
          referrer: s.referrer ?? null,
          channel: s.channel,
          device: s.device,
          region: s.region,
        },
      });
      let i = 0;
      for (const [idx, name] of s.events.entries()) {
        const eid = randomUUID();
        eventIds.push(eid);
        // page_views walk landing → exit, so exit pages have page views.
        const path = name === 'page_view' && i++ > 0 ? s.exit : s.landing;
        await prisma.event.create({
          data: {
            id: eid,
            ts: new Date(startedAt.getTime() + (s.offsets?.[idx] ?? idx) * 1000),
            sessionId: id,
            anonymousId: `${run}-${s.anon}`,
            name,
            path,
          },
        });
      }
    }
    // Purchases (current period): o1 1 000 000 PAID; o2 COD confirmed 500 000;
    // o3 phone order 300 000 PAID with 50 000 refunded → 250 000.
    await order('o1', 'c1', { soum: 1_000_000, at: at(10, 12), payment: 'PAID', session: 's3' });
    await order('o2', 'c2', {
      soum: 500_000,
      at: at(11, 10),
      status: 'CONFIRMED',
      method: 'COD',
      payment: 'COD_PENDING',
      session: 's4',
    });
    await order('o3', 'c3', {
      soum: 300_000,
      at: at(12, 11),
      payment: 'PARTIALLY_REFUNDED',
      refundSoum: 50_000,
      source: 'phone',
    });
    // Not purchases: unconfirmed COD, unpaid online, cancelled.
    await order('o4', 'c4', {
      soum: 700_000,
      at: at(12, 12),
      status: 'NEW',
      method: 'COD',
      payment: 'COD_PENDING',
    });
    await order('o5', 'c4', { soum: 900_000, at: at(13, 12), status: 'NEW', payment: 'PENDING' });
    await order('o8', 'c4', {
      soum: 800_000,
      at: at(13, 13),
      status: 'CANCELLED',
      payment: 'PAID',
    });
    // Previous period: o6 200 000; next month: c1 buys again (cohort retention).
    await order('o6', 'c6', { soum: 200_000, at: at(3, 13), payment: 'PAID', session: 's5' });
    const next = new Date(tashkentDayKeyStart(`${NEXT}-05`).getTime() + 12 * H);
    await order('o7', 'c1', { soum: 150_000, at: next, payment: 'PAID' });

    const attribution = app.get(AttributionService);
    for (const k of ['o1', 'o2', 'o3', 'o6', 'o7']) await attribution.computeOrder(oid.get(k)!);

    // Realtime: three live sessions and one older than 30 minutes.
    const now = Date.now();
    for (const [i, id] of liveIds.entries()) {
      await redis.zadd(RT_SESSIONS, now - i * 60_000, id);
      await redis.hset(rtSessionKey(id), {
        path: `/uz/${run}`,
        channel: `rt_${run}`,
        device: 'mobile',
        region: 'Toshkent',
      });
    }
    await redis.zadd(RT_SESSIONS, now - 40 * 60_000, staleId);
  });

  afterAll(async () => {
    try {
      const orders = [...oid.values()];
      await prisma.refund.deleteMany({ where: { payment: { orderId: { in: orders } } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orders } } });
      await prisma.order.deleteMany({ where: { id: { in: orders } } });
      await prisma.$executeRaw`DELETE FROM "Event" WHERE id = ANY(${eventIds})`;
      await prisma.session.deleteMany({ where: { id: { in: [...sid.values()] } } });
      await prisma.visitor.deleteMany({ where: { anonymousId: { startsWith: `${run}-` } } });
      await prisma.customer.deleteMany({ where: { id: { in: [...cid.values()] } } });
      await prisma.$executeRaw`DELETE FROM "AdSpendDaily" WHERE "campaignId" LIKE ${`${run}%`}`;
      await prisma.auditLog.deleteMany({ where: { entity: 'AdSpendDaily' } });
      await redis.zrem(RT_SESSIONS, ...liveIds, staleId);
      await redis.del(...liveIds.map(rtSessionKey));
      FakeAdSpendSource.reset();
    } finally {
      await app.close();
    }
  });

  it('imports ad spend CSV idempotently (audited), refuses bad files whole', async () => {
    const csv = [
      'date,platform,campaign_id,campaign,adset,spend,impressions,clicks',
      `${day(8)},meta,${run}-m1,divan_reels,reels,100000,5000,120`,
      `${day(12)},meta,${run}-m1,divan_reels,reels,60000,3000,80`,
      `${day(9)},google,${run}-g1,brand_${run},,40000,2000,30`,
    ].join('\n');
    const marketer = clients.get('MARKETER')!;
    const first = await marketer.post('/v1/admin/analytics/ad-spend/import', { csv });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body as AdSpendImportResultDto).toMatchObject({
      rows: 3,
      inserted: 3,
      updated: 0,
    });
    const again = await marketer.post('/v1/admin/analytics/ad-spend/import', { csv });
    expect(again.body as AdSpendImportResultDto).toMatchObject({
      rows: 3,
      inserted: 0,
      updated: 3,
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'adspend.import', entity: 'AdSpendDaily' } }),
    ).toBeGreaterThanOrEqual(2);

    const bad = await marketer.post('/v1/admin/analytics/ad-spend/import', {
      csv: `date,platform,campaign_id,spend\n${day(8)},meta,${run}-bad,1\nnope,meta,${run}-bad,1\n`,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('AD_SPEND_CSV_INVALID');
    expect(bad.body.error.details.errors).toEqual([expect.objectContaining({ line: 3 })]);
    expect(await prisma.adSpendDaily.count({ where: { campaignId: `${run}-bad` } })).toBe(0);

    const op = await clients.get('OPERATOR')!.post('/v1/admin/analytics/ad-spend/import', { csv });
    expect(op.status).toBe(403);
  });

  it('API spend sync goes through the adapter (fake mode)', async () => {
    FakeAdSpendSource.seed([
      {
        date: day(20),
        platform: 'tiktok',
        campaignId: `${run}-t1`,
        campaign: 'tt',
        adset: null,
        spendTiyin: 1_000_000n,
        impressions: 1,
        clicks: 1,
      },
    ]);
    const res = await clients.get('OWNER')!.post('/v1/admin/analytics/ad-spend/sync', {
      platform: 'tiktok',
      from: day(15),
      to: day(25),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ rows: 1, inserted: 1 });
  });

  it('A1 KPIs, visits, funnel and channels equal the seed', async () => {
    const d = await get<DashboardDto>(`/dashboard?${Q}`);
    expect(d.period).toMatchObject({
      firstDay: day(8),
      lastDay: day(14),
      previousFirstDay: day(1),
    });
    // Current: 7 sessions (s1–s4, s6–s8) of 5 visitors; purchases o1, o2, o3.
    expect(d.kpis).toEqual({
      sessions: { value: 7, previous: 2 },
      visitors: { value: 5, previous: 2 },
      orders: { value: 3, previous: 1 },
      revenueSoum: { value: 1_750_000, previous: 200_000 },
      conversionRate: { value: 3 / 7, previous: 0.5 },
      aovSoum: { value: 583_333, previous: 200_000 },
      leads: { value: 2, previous: 1 },
    });
    expect(d.visits).toEqual([
      { day: day(8), sessions: 1, orders: 0, revenueSoum: 0 },
      { day: day(9), sessions: 1, orders: 0, revenueSoum: 0 },
      { day: day(10), sessions: 1, orders: 1, revenueSoum: 1_000_000 },
      { day: day(11), sessions: 1, orders: 1, revenueSoum: 500_000 },
      { day: day(12), sessions: 1, orders: 1, revenueSoum: 250_000 },
      { day: day(13), sessions: 1, orders: 0, revenueSoum: 0 },
      { day: day(14), sessions: 1, orders: 0, revenueSoum: 0 },
    ]);
    expect(d.funnel).toEqual([
      { step: 'visit', sessions: 7 },
      { step: 'view_item', sessions: 4 },
      { step: 'add_to_cart', sessions: 2 },
      { step: 'begin_checkout', sessions: 2 },
      { step: 'purchase', sessions: 2 },
    ]);
    // Last non-direct: o1 → telegram (s2), o2 → organic_search, o3 → phone.
    const ch = new Map(d.channels!.map((c) => [c.channel, c]));
    expect(ch.get('telegram')).toEqual({
      channel: 'telegram',
      sessions: 1,
      purchasingSessions: 0,
      orders: 1,
      revenueSoum: 1_000_000,
    });
    expect(ch.get('direct')).toMatchObject({ sessions: 2, purchasingSessions: 1, orders: 0 });
    expect(ch.get('organic_search')).toMatchObject({
      sessions: 1,
      purchasingSessions: 1,
      revenueSoum: 500_000,
    });
    expect(ch.get('phone')).toMatchObject({ sessions: 0, orders: 1, revenueSoum: 250_000 });
    expect(ch.get('paid_meta')).toMatchObject({ sessions: 2, orders: 0 });
    expect(d.topProducts?.[0]).toMatchObject({ productId: variant.productId });
    expect(typeof d.activeNow).toBe('number');
  });

  it('dashboard.view alone gets no analytics blocks', async () => {
    const d = await get<DashboardDto>(`/dashboard?${Q}`, 'OPERATOR');
    expect(d).toMatchObject({
      kpis: null,
      visits: null,
      funnel: null,
      channels: null,
      activeNow: null,
    });
    expect(Array.isArray(d.latestOrders)).toBe(true);
    expect(d.attention.some((a) => a.kind === 'anomaly' || a.kind === 'opportunity')).toBe(false);
    for (const path of ['sources', 'pages', 'events', 'funnel', 'devices', 'cohorts', 'realtime'])
      expect((await clients.get('OPERATOR')!.get(`/v1/admin/analytics/${path}?${Q}`)).status).toBe(
        403,
      );
  });

  it('A2 sources: model-attributed revenue, spend split per campaign, ROAS', async () => {
    const s = await get<SourcesDto>(`/analytics/sources?${Q}`);
    const row = (source: string, campaign: string | null = null) =>
      s.rows.find((r) => r.source === source && r.campaign === campaign);
    expect(row('instagram', 'divan_reels')).toMatchObject({
      medium: 'cpc',
      platform: 'meta',
      sessions: 1,
      bounceRate: 0,
      avgDurationSec: 120,
      orders: 0,
      revenueSoum: 0,
      // 160 000 of meta spend split 1:1 with the facebook row (same campaign, any case).
      spendSoum: 80_000,
      roas: 0,
    });
    expect(row('facebook', 'DIVAN_REELS')).toMatchObject({
      sessions: 1,
      bounceRate: 1,
      spendSoum: 80_000,
    });
    expect(row('telegram', 'kanal_post')).toMatchObject({
      sessions: 1,
      orders: 1,
      revenueSoum: 1_000_000,
    });
    expect(row('(direct)')).toMatchObject({ medium: '(none)', sessions: 2, orders: 0 });
    expect(row('google.com')).toMatchObject({
      medium: 'organic',
      sessions: 1,
      orders: 1,
      revenueSoum: 500_000,
    });
    expect(row('example.uz')).toMatchObject({ medium: 'referral', sessions: 1, leads: 1 });
    expect(row('phone')).toMatchObject({ sessions: 0, orders: 1, revenueSoum: 250_000 });
    // Spend with no traffic still shows (google brand campaign).
    expect(row('google', `brand_${run}`)).toMatchObject({ sessions: 0, spendSoum: 40_000 });
    expect(s.totals).toEqual({
      sessions: 7,
      leads: 1,
      orders: 3,
      revenueSoum: 1_750_000,
      spendSoum: 200_000,
      roas: 1_750_000 / 200_000,
    });
    expect(s.previousTotals).toMatchObject({
      sessions: 2,
      orders: 1,
      revenueSoum: 200_000,
      spendSoum: 0,
    });
    expect(s.pendingOrders).toBe(0);

    const first = await get<SourcesDto>(`/analytics/sources?${Q}&model=first_touch`);
    expect(first.rows.find((r) => r.source === 'instagram')).toMatchObject({
      orders: 1,
      revenueSoum: 1_000_000,
      roas: 1_000_000 / 80_000,
    });
    const linear = await get<SourcesDto>(`/analytics/sources?${Q}&model=linear`);
    expect(linear.rows.find((r) => r.source === 'instagram')).toMatchObject({
      orders: 0.33,
      revenueSoum: 333_333,
    });
    expect(linear.rows.find((r) => r.source === '(direct)')).toMatchObject({
      revenueSoum: 333_333,
    });

    const mobile = await get<SourcesDto>(`/analytics/sources?${Q}&device=mobile&compare=0`);
    expect(mobile.totals).toMatchObject({ sessions: 5, orders: 2, revenueSoum: 1_500_000 });
    expect(mobile.previousTotals).toBeNull();
    expect(mobile.rows.every((r) => r.spendSoum === null)).toBe(true);
  });

  it('A2 landing/exit, events & goals, devices, funnel', async () => {
    const p = await get<PagesDto>(`/analytics/pages?${Q}`);
    expect(p.landing).toEqual([
      { path: '/uz', sessions: 3, bounceRate: 1 / 3 },
      { path: '/uz/katalog', sessions: 2, bounceRate: 1 },
      { path: '/uz/p/chalk-white', sessions: 2, bounceRate: 0 },
    ]);
    const exit = new Map(p.exit.map((x) => [x.path, x]));
    // /uz/savat: exits s3, s4; page views: s3's second page_view only.
    expect(exit.get('/uz/savat')).toMatchObject({ exits: 2, pageviews: 1, exitRate: 1 });
    // /uz/katalog: s2 + s7 exit; both their only page_view.
    expect(exit.get('/uz/katalog')).toMatchObject({ exits: 2, pageviews: 2, exitRate: 1 });

    const e = await get<EventsDto>(`/analytics/events?${Q}`);
    expect(e.overall).toEqual({ sessions: 7, purchasingSessions: 2, rate: 2 / 7 });
    const ev = new Map(e.events.map((x) => [x.name, x]));
    expect(ev.get('selector_used')).toMatchObject({
      sessions: 2,
      count: 2,
      purchasingSessions: 1,
      rate: 0.5,
      lift: 0.5 / (2 / 7),
    });
    expect(ev.get('add_to_cart')).toMatchObject({ sessions: 2, purchasingSessions: 2 });
    expect(ev.has('page_view')).toBe(false);
    expect(e.insight).toBeNull(); // too few sessions for a finding

    const dv = await get<DevicesDto>(`/analytics/devices?${Q}`);
    expect(dv.devices).toEqual([
      { device: 'mobile', sessions: 5, share: 5 / 7, purchasingSessions: 2, conversionRate: 0.4 },
      expect.objectContaining({ sessions: 1, purchasingSessions: 0 }),
      expect.objectContaining({ sessions: 1, purchasingSessions: 0 }),
    ]);
    expect(dv.regions[0]).toEqual({ region: 'Toshkent', sessions: 5, purchasingSessions: 1 });

    const f = await get<FunnelDto>(`/analytics/funnel?${Q}`);
    expect(f.previous?.map((x) => x.sessions)).toEqual([2, 0, 1, 0, 1]);
    expect(f.byDevice.find((x) => x.device === 'mobile')?.steps.map((x) => x.sessions)).toEqual([
      5, 3, 2, 2, 2,
    ]);
  });

  it('repeat-purchase cohorts', async () => {
    const reports = app.get(ReportsService);
    const at20 = new Date(tashkentDayKeyStart(`${NEXT}-20`).getTime());
    const c: CohortsDto = await reports.cohorts(at20);
    // First purchases in the test month: c1, c2, c3, c6; c1 buys again next month.
    expect(c.cohorts.find((x) => x.month === `${Y}-${MM}`)).toEqual({
      month: `${Y}-${MM}`,
      customers: 4,
      retention: [0.25, null, null, null, null],
    });
  });

  it('realtime reads the ingest keys', async () => {
    const rt = await get<RealtimeDto>('/analytics/realtime');
    const expected = await redis.zcount(RT_SESSIONS, Date.now() - 30 * 60_000, '+inf');
    expect(rt.activeNow).toBe(expected);
    expect(rt.activeNow).toBeGreaterThanOrEqual(3);
    expect(rt.channels.find((x) => x.channel === `rt_${run}`)?.sessions).toBe(3);
    expect(rt.perMinute).toHaveLength(30);
  });

  it('order journey: stored shares and revenue per model', async () => {
    const j = await get<OrderJourneyDto>(`/analytics/orders/${onum.get('o1')}/journey`);
    expect(j.state).toBe('attributed');
    expect(j.revenueSoum).toBe(1_000_000);
    expect(j.touches.map((x) => [x.channel, x.source, x.campaign])).toEqual([
      ['paid_meta', 'instagram', 'divan_reels'],
      ['telegram', 'telegram', 'kanal_post'],
      ['direct', '(direct)', null],
    ]);
    expect(j.touches.map((x) => x.revenueSoum.last_non_direct)).toEqual([0, 1_000_000, 0]);
    expect(j.touches.map((x) => x.revenueSoum.first_touch)).toEqual([1_000_000, 0, 0]);
    expect(j.touches.map((x) => x.revenueSoum.linear).reduce((a, b) => a + b)).toBe(1_000_000);
    expect(j.purchaseSession?.id).toBe(sid.get('s3'));

    // o7 (repeat purchase) only looks back to o1: no session after it → the order's own touch.
    const j7 = await get<OrderJourneyDto>(`/analytics/orders/${onum.get('o7')}/journey`);
    expect(j7.touches.map((x) => x.channel)).toEqual(['direct']);
    expect(j7.touches[0]!.kind).toBe('order');

    // o6's session is anonymous and its visitor unlinked: found through Order.sessionId.
    const j6 = await get<OrderJourneyDto>(`/analytics/orders/${onum.get('o6')}/journey`);
    expect(j6.touches.map((x) => [x.kind, x.sessionId])).toEqual([['session', sid.get('s5')]]);

    const j4 = await get<OrderJourneyDto>(`/analytics/orders/${onum.get('o4')}/journey`);
    expect(j4.state).toBe('not_purchase');
    expect(
      (await clients.get('OPERATOR')!.get(`/v1/admin/analytics/orders/${onum.get('o1')}/journey`))
        .status,
    ).toBe(403);
  });

  it('customer journey: sessions via the visitor, summary and CAC', async () => {
    const j = await get<CustomerJourneyDto>(`/analytics/customers/${cid.get('c1')}/journey`);
    expect(j.sessions.map((s) => s.id)).toEqual([sid.get('s3'), sid.get('s2'), sid.get('s1')]);
    expect(j.sessions[0]).toMatchObject({
      viewedItems: 1,
      addedToCart: 1,
      beganCheckout: true,
      orderNumber: onum.get('o1'),
    });
    expect(j.summary).toMatchObject({
      sessions: 3,
      channels: ['paid_meta', 'telegram', 'direct'],
      // s1 day 8 10:00 → o1 day 10 12:00 = 2 d 2 h.
      visitToPurchaseDays: 2.1,
      // Day 8 meta divan_reels spend 100 000 over its 1 session that day (s1).
      cacSoum: 100_000,
    });
    expect(j.summary.firstTouch).toMatchObject({ source: 'instagram', campaign: 'divan_reels' });
    expect(j.summary.lastTouch).toMatchObject({ channel: 'direct' });
    const none = await get<CustomerJourneyDto>(`/analytics/customers/${cid.get('c4')}/journey`);
    expect(none.summary).toMatchObject({ sessions: 0, cacSoum: null, firstTouch: null });
  });
});
