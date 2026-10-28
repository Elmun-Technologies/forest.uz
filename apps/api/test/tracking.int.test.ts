import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { tashkentDayKey } from '@forest/contracts';
import request from 'supertest';
import { OrderLifecycleService } from '../src/commerce/order-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import { IdentityService } from '../src/tracking/identity.service';
import { REALTIME_SESSIONS, realtimeSessionKey } from '../src/tracking/ingest.service';
import { leadEventId, purchaseEventId } from '../src/tracking/server-events';
import { createTestApp, nextTestIp } from './app';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PHONE_RE = /(?:\+?\d[\s\-().]*){9,}/;
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;

let phoneSeq = Math.floor(Math.random() * 9_000_000);
const nextPhone = () => `+99893${String(phoneSeq++ % 10_000_000).padStart(7, '0')}`;

/** A browser: keeps cookies (fr_aid, fr_session), own IP, fixed UA. */
function browser(app: NestExpressApplication, ua = MOBILE_UA) {
  const agent = request.agent(app.getHttpServer());
  const ip = nextTestIp();
  return {
    agent,
    send(sid: string, events: unknown[], extra: Record<string, unknown> = {}, now = Date.now()) {
      return agent
        .post('/v1/t')
        .set('User-Agent', ua)
        .set('X-Forwarded-For', ip)
        .set('Content-Type', 'text/plain;charset=UTF-8')
        .send(JSON.stringify({ v: 1, sid, now, events, ...extra }));
    },
  };
}

const ev = (name: string, path: string, props?: unknown, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  name,
  t: Date.now(),
  path,
  ...(props ? { props } : {}),
  ...extra,
});

function cookieValue(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith(`${name}=`));
  if (!c) throw new Error(`no ${name} cookie`);
  return c.split(';')[0]!.slice(name.length + 1);
}
const aidFrom = (res: request.Response) => cookieValue(res, 'fr_aid');

describe('tracker ingest POST /v1/t (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const visitors: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    const sessions = await prisma.session.findMany({
      where: { anonymousId: { in: visitors } },
      select: { id: true },
    });
    const ids = sessions.map((s) => s.id);
    await prisma.event.deleteMany({
      where: { OR: [{ sessionId: { in: ids } }, { anonymousId: { in: visitors } }] },
    });
    await prisma.session.deleteMany({ where: { id: { in: ids } } });
    await prisma.visitor.deleteMany({ where: { anonymousId: { in: visitors } } });
    await app.close();
  });

  it('landing batch → Session, Event, Visitor rows, fr_aid cookie and realtime keys', async () => {
    const b = browser(app);
    const sid = randomUUID();
    const res = await b
      .send(sid, [
        ev('page_view', '/uz/p/divan-toplami?utm_source=fb', {
          landing: true,
          nav: 'load',
          locale: 'uz',
          referrer: 'https://l.instagram.com/',
          utm: { source: 'facebook', medium: 'cpc', campaign: 'kuz-2026' },
          clickIds: { fbclid: 'IwAR0abc' },
        }),
        ev(
          'click',
          '/uz/p/divan-toplami',
          { tag: 'button', track: 'add_to_cart' },
          {
            selector: '#main>section>button',
            x: 512,
            y: 1340,
            viewportW: 390,
          },
        ),
      ])
      .expect(204);
    const aid = aidFrom(res);
    visitors.push(aid);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(session).toMatchObject({
      anonymousId: aid,
      landingPath: '/uz/p/divan-toplami',
      exitPath: '/uz/p/divan-toplami',
      channel: 'paid_meta',
      device: 'mobile',
      os: 'Android',
      browser: 'Chrome',
      pageviews: 1,
      events: 2,
      bounced: true,
      utm: { source: 'facebook', medium: 'cpc', campaign: 'kuz-2026' },
      clickIds: { fbclid: 'IwAR0abc' },
      referrer: 'https://l.instagram.com/',
    });
    const events = await prisma.event.findMany({
      where: { sessionId: sid },
      orderBy: { ts: 'asc' },
    });
    expect(events.map((e) => e.name)).toEqual(['page_view', 'click']);
    expect(events[1]).toMatchObject({
      selector: '#main>section>button',
      x: 512,
      y: 1340,
      viewportW: 390,
    });
    const visitor = await prisma.visitor.findUniqueOrThrow({ where: { anonymousId: aid } });
    expect(visitor.firstTouch).toMatchObject({
      channel: 'paid_meta',
      source: 'facebook',
      campaign: 'kuz-2026',
      clickId: 'fbclid:IwAR0abc',
      landing: '/uz/p/divan-toplami',
    });
    expect(visitor.lastTouch).toEqual(visitor.firstTouch);

    expect(await redis.zscore(REALTIME_SESSIONS, sid)).not.toBeNull();
    expect(await redis.hgetall(realtimeSessionKey(sid))).toEqual({
      path: '/uz/p/divan-toplami',
      channel: 'paid_meta',
      device: 'mobile',
      region: '',
    });
    expect(await redis.ttl(realtimeSessionKey(sid))).toBeGreaterThan(1700);

    // Next batch of the same session: aggregates move, landing context stays.
    await b
      .send(sid, [
        ev('add_to_cart', '/uz/p/divan-toplami', { variantId: 'v1', qty: 1, priceSoum: 450000 }),
        ev('page_view', '/uz/savat', { nav: 'spa' }),
      ])
      .expect(204);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(after).toMatchObject({
      pageviews: 2,
      events: 4,
      bounced: false,
      exitPath: '/uz/savat',
      landingPath: '/uz/p/divan-toplami',
      channel: 'paid_meta',
    });
  });

  it('drops bots, automation, junk and oversize bodies (always 204)', async () => {
    const sid = randomUUID();
    const headless = browser(
      app,
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    );
    await headless.send(sid, [ev('page_view', '/uz')]).expect(204);
    const wd = browser(app);
    await wd.send(sid, [ev('page_view', '/uz')], { wd: true }).expect(204);
    await browser(app, 'curl/8.5.0')
      .send(sid, [ev('page_view', '/uz')])
      .expect(204);
    const junk = browser(app);
    await junk.agent
      .post('/v1/t')
      .set('User-Agent', MOBILE_UA)
      .set('Content-Type', 'text/plain')
      .send('{not json')
      .expect(204);
    // JSON-typed bodies never come from the tracker (always text/plain): dropped.
    await junk.agent
      .post('/v1/t')
      .set('User-Agent', MOBILE_UA)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ v: 1, sid, now: Date.now(), events: [ev('page_view', '/uz')] }))
      .expect(204);
    await junk.agent
      .post('/v1/t')
      .set('User-Agent', MOBILE_UA)
      .set('Content-Type', 'text/plain')
      .send(
        JSON.stringify({
          v: 1,
          sid,
          now: Date.now(),
          events: [ev('page_view', '/uz', { x: 'y'.repeat(70_000) })],
        }),
      )
      .expect(204);
    expect(await prisma.session.findUnique({ where: { id: sid } })).toBeNull();
  });

  it('server-only and invalid events are dropped, the rest of the batch kept', async () => {
    const b = browser(app, DESKTOP_UA);
    const sid = randomUUID();
    const res = await b
      .send(sid, [
        ev('page_view', '/ru', { nav: 'load' }),
        ev('purchase', '/ru', { orderNumber: 'F-1', valueTiyin: '1' }),
        ev('lead', '/ru', { source: 'popup' }),
        ev('add_to_cart', '/ru', {}),
        { id: 'not-a-uuid', name: 'page_view', t: 1, path: '/' },
      ])
      .expect(204);
    visitors.push(aidFrom(res));
    const events = await prisma.event.findMany({ where: { sessionId: sid } });
    expect(events.map((e) => e.name)).toEqual(['page_view']);
    const s = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(s).toMatchObject({ channel: 'direct', device: 'desktop', os: 'Windows' });
  });

  it('a session id of another visitor is never joined', async () => {
    const a = browser(app);
    const sid = randomUUID();
    visitors.push(aidFrom(await a.send(sid, [ev('page_view', '/uz')]).expect(204)));
    const other = browser(app);
    visitors.push(aidFrom(await other.send(sid, [ev('page_view', '/uz/katalog')]).expect(204)));
    const events = await prisma.event.findMany({ where: { sessionId: sid } });
    expect(events.map((e) => e.path)).toEqual(['/uz']);
  });

  it('no PII in stored events (phones, emails, capability paths)', async () => {
    const b = browser(app);
    const sid = randomUUID();
    const res = await b
      .send(sid, [
        ev('page_view', '/uz/t/SecretTrackingToken123?phone=998901234567', { nav: 'load' }),
        ev('page_view', '/uz/obuna/SecretOptOutToken456', { nav: 'spa' }),
        ev('page_view', '/c/SecretCartToken789', { nav: 'spa' }),
        ev('page_view', '/uz/p/+998901234567', { nav: 'spa' }),
        ev('search', '/uz/qidiruv?q=ali@mail.uz', {
          q: 'menga +998 90 123 45 67 qo‘ng‘iroq',
          results: 0,
        }),
        ev('search', '/uz/qidiruv', { q: 'ali.valiyev@gmail.com', results: 0 }),
        ev('form_error', '/uz/checkout', { field: 'phone', kind: 'required', value: '901234567' }),
        ev('js_error', '/uz', { message: 'Failed for +998901234567 at https://x.uz/a.js?t=1' }),
        ev('js_error', '/uz', { message: `TypeError: bad value "Ali Valiyev" (id 12345)` }),
        ev(
          'click',
          '/uz',
          { tag: 'a', track: 'ali@mail.uz', email: 'ali@mail.uz' },
          {
            selector: '#main>a',
            x: 1,
            y: 2,
            viewportW: 390,
          },
        ),
        ev('view_item', '/uz/p/x', {
          productId: 'p1',
          phone: '+998901234567',
          name: 'Ali Valiyev',
        }),
      ])
      .expect(204);
    visitors.push(aidFrom(res));
    const rows = await prisma.event.findMany({ where: { sessionId: sid } });
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const r of rows) {
      const text = JSON.stringify({ path: r.path, props: r.props, selector: r.selector });
      expect(text, text).not.toMatch(PHONE_RE);
      expect(text, text).not.toMatch(EMAIL_RE);
      expect(text).not.toMatch(/SecretTrackingToken123|SecretOptOutToken456|SecretCartToken789/);
      expect(text).not.toContain('Ali Valiyev');
    }
    expect(rows.map((r) => r.path)).toEqual(
      expect.arrayContaining(['/uz/t/:token', '/uz/obuna/:token', '/c/:token']),
    );
    expect(rows.find((r) => JSON.stringify(r.props).includes('TypeError'))?.props).toEqual({
      message: 'TypeError: bad value "…" (id #)',
    });
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(session.landingPath).toBe('/uz/t/:token');
  });

  it('identity: login links the visitor, stamps its sessions/events and copies touches', async () => {
    const b = browser(app);
    const sid = randomUUID();
    const res = await b
      .send(sid, [
        ev('page_view', '/uz', {
          landing: true,
          utm: { source: 'telegram', medium: 'post', campaign: 'oktabr' },
        }),
      ])
      .expect(204);
    const aid = aidFrom(res);
    visitors.push(aid);
    const id = String(7_100_000_000 + Math.floor(Math.random() * 1_000_000));
    const me = await b.agent
      .post('/v1/dev/telegram-login')
      .send({ id, first_name: 'Aziza' })
      .expect(200);
    const customerId = (me.body as { id: string }).id;

    expect(
      (await prisma.visitor.findUniqueOrThrow({ where: { anonymousId: aid } })).customerId,
    ).toBe(customerId);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).customerId).toBe(
      customerId,
    );
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.firstTouch).toMatchObject({
      channel: 'telegram',
      source: 'telegram',
      campaign: 'oktabr',
    });
    expect(customer.lastTouch).toMatchObject({ channel: 'telegram' });

    await app.get(IdentityService).backfill(aid, customerId);
    const events = await prisma.event.findMany({ where: { sessionId: sid } });
    expect(events.every((e) => e.customerId === customerId)).toBe(true);

    // Logged in: new events carry the customer at once.
    await b.send(sid, [ev('view_cart', '/uz/savat', { itemsCount: 0, valueSoum: 0 })]).expect(204);
    const latest = await prisma.event.findFirstOrThrow({
      where: { sessionId: sid, name: 'view_cart' },
    });
    expect(latest.customerId).toBe(customerId);
  });

  it('checkout stores visitor + session; COD confirm writes one purchase; lead event', async () => {
    const b = browser(app);
    const sid = randomUUID();
    const first = await b.send(sid, [ev('page_view', '/uz', { landing: true })]).expect(204);
    const aid = aidFrom(first);
    visitors.push(aid);
    const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-CW-1000' } });
    const ip = nextTestIp();
    const http = () => request(app.getHttpServer());
    const added = await http()
      .post('/v1/cart/items')
      .set('X-Forwarded-For', ip)
      .set('Cookie', `fr_aid=${aid}`)
      .send({ variantId: variant.id, qty: 1 })
      .expect(201);
    const cart = cookieValue(added, 'fr_cart');
    const cookie = `fr_aid=${aid}; fr_sid=${sid}; fr_cart=${cart}`;
    const placed = await http()
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', ip)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `trk-${randomUUID()}`)
      .send({
        name: 'Dilnoza',
        phone: nextPhone(),
        region: 'tashkent_city',
        district: 'mirzo_ulugbek',
        addressLine: "Mirzo Ulug'bek, 5-uy",
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'COD',
        offerVersion: '2026-10-26-draft',
      });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { publicId: placed.body.publicId },
    });
    expect(order).toMatchObject({ anonymousId: aid, sessionId: sid });

    const lifecycle = app.get(OrderLifecycleService);
    await lifecycle.confirmCod(order.id, { type: 'SYSTEM' });
    const purchases = await prisma.event.findMany({ where: { name: 'purchase', sessionId: sid } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      id: purchaseEventId(order.id),
      anonymousId: aid,
      customerId: order.customerId,
      props: {
        orderNumber: order.number,
        currency: 'UZS',
        paymentMethod: 'COD',
        valueTiyin: order.totalTiyin.toString(),
      },
    });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
      converted: true,
      orderId: order.id,
    });
    // The checkout phone is unverified: the browser is NOT linked to the phone's customer.
    expect(
      (await prisma.visitor.findUniqueOrThrow({ where: { anonymousId: aid } })).customerId,
    ).toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).customerId).toBeNull();

    // Lead from the same browser: one server-side event per source and day.
    const phone = nextPhone();
    for (let i = 0; i < 2; i++)
      await http()
        .post('/v1/leads')
        .set('X-Forwarded-For', nextTestIp())
        .set('Cookie', cookie)
        .set('Referer', 'http://localhost:3000/uz/p/divan?utm_source=x')
        .send({ phone, source: 'popup' })
        .expect(200);
    const lead = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    const leads = await prisma.event.findMany({ where: { name: 'lead', customerId: lead.id } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      sessionId: sid,
      anonymousId: aid,
      path: '/uz/p/divan',
      props: { source: 'popup' },
    });
    expect(leads[0]!.id).toBe(leadEventId(lead.id, 'popup', tashkentDayKey(leads[0]!.ts)));
    // Leads don't link either (anyone can type someone else's phone).
    expect(
      (await prisma.visitor.findUniqueOrThrow({ where: { anonymousId: aid } })).customerId,
    ).toBeNull();

    // A crafted fr_sid naming another visitor's session is neither stored nor marked converted.
    const victim = browser(app);
    const victimSid = randomUUID();
    visitors.push(aidFrom(await victim.send(victimSid, [ev('page_view', '/uz')]).expect(204)));
    const added2 = await http()
      .post('/v1/cart/items')
      .set('X-Forwarded-For', ip)
      .set('Cookie', `fr_aid=${aid}`)
      .send({ variantId: variant.id, qty: 1 })
      .expect(201);
    const crafted = await http()
      .post('/v1/checkout/orders')
      .set('X-Forwarded-For', ip)
      .set(
        'Cookie',
        `fr_aid=${aid}; fr_sid=${victimSid}; fr_cart=${cookieValue(added2, 'fr_cart')}`,
      )
      .set('Idempotency-Key', `trk-${randomUUID()}`)
      .send({
        name: 'Dilnoza',
        phone: nextPhone(),
        region: 'tashkent_city',
        district: 'mirzo_ulugbek',
        addressLine: "Mirzo Ulug'bek, 5-uy",
        zoneKey: 'tashkent-city-yandex',
        paymentMethod: 'COD',
        offerVersion: '2026-10-26-draft',
      });
    expect(crafted.status, JSON.stringify(crafted.body)).toBe(201);
    const craftedOrder = await prisma.order.findUniqueOrThrow({
      where: { publicId: crafted.body.publicId },
    });
    expect(craftedOrder.sessionId).toBeNull();
    await lifecycle.confirmCod(craftedOrder.id, { type: 'SYSTEM' });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: victimSid } })).converted).toBe(
      false,
    );
    await lifecycle.cancelOrder(craftedOrder.id, { type: 'SYSTEM' }, 'test cleanup');

    await lifecycle.cancelOrder(order.id, { type: 'SYSTEM' }, 'test cleanup');
  });

  it('dev events endpoint lists a session', async () => {
    const b = browser(app);
    const sid = randomUUID();
    visitors.push(aidFrom(await b.send(sid, [ev('page_view', '/uz')]).expect(204)));
    const res = await request(app.getHttpServer())
      .get(`/v1/dev/events?sessionId=${sid}`)
      .expect(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.events.map((e: { name: string }) => e.name)).toEqual(['page_view']);
  });
});
