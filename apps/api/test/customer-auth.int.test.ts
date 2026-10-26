import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CART_MERGER, type CartMerger } from '../src/customer/cart-merger';
import { verifyDeepLink } from '../src/customer/deeplink';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.module';
import { createTestApp } from './app';

let seq = 0;
const base = Math.floor(Math.random() * 9_000_000);
/** Unique valid phone/IP per call: rate limits live in a Redis shared by all test files. */
const nextPhone = () => `+99890${String((base + seq++) % 10_000_000).padStart(7, '0')}`;
const nextIp = () => `10.20.${Math.floor(seq / 250) % 250}.${seq++ % 250}`;

describe('customer auth, /me, leads, waitlist (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  function lastCode(phone: string): string {
    const msg = integrations.outbox.list(phone).find((m) => m.templateKey === 'otp');
    const code = msg?.text.match(/\b(\d{4})\b/)?.[1];
    if (!code) throw new Error('no OTP in outbox');
    return code;
  }

  const wrong = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, '0');

  function sessionCookie(res: request.Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const c = raw?.find((x) => x.startsWith('fr_session='));
    if (!c) throw new Error('no session cookie');
    return c.split(';')[0]!;
  }

  async function login(phone = nextPhone(), cookie?: string) {
    const ip = nextIp();
    await http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone }).expect(200);
    const req = http().post('/v1/auth/otp/verify').set('X-Forwarded-For', ip);
    if (cookie) req.set('Cookie', cookie);
    const res = await req.send({ phone, code: lastCode(phone) }).expect(200);
    return { phone, cookie: sessionCookie(res), me: res.body as { id: string; phone: string } };
  }

  // ───────── OTP ─────────

  it('rejects /me without a session', async () => {
    const res = await http().get('/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs in with OTP: hashed code, httpOnly session cookie, /me works', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    const sent = await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'ru')
      .send({
        phone: `${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9, 11)} ${phone.slice(11)}`,
      })
      .expect(200);
    expect(sent.body).toEqual({ resendInSec: 60, expiresInSec: 300 });
    const code = lastCode(phone);
    expect(integrations.outbox.list(phone)[0]?.text).toContain('Никому не сообщайте');

    const row = await prisma.otpCode.findFirstOrThrow({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code);

    const bad = await http()
      .post('/v1/auth/otp/verify')
      .send({ phone, code: wrong(code) })
      .expect(400);
    expect(bad.body.error).toMatchObject({
      code: 'OTP_INVALID',
      field: 'code',
      details: { attemptsLeft: 4 },
    });

    const ok = await http()
      .post('/v1/auth/otp/verify')
      .set('Accept-Language', 'ru-RU,ru;q=0.9')
      .send({ phone, code })
      .expect(200);
    const setCookie = (ok.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/fr_session=[\w-]+/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(ok.body).toMatchObject({
      phone,
      locale: 'ru',
      ordersCount: 0,
      consents: { smsMarketing: false },
    });
    expect(ok.body.publicId).toMatch(/^C-\d+$/);

    const me = await http().get('/v1/me').set('Cookie', sessionCookie(ok)).expect(200);
    expect(me.body.id).toBe(ok.body.id);
    expect(me.headers['cache-control']).toContain('no-store');

    // A used code can't be replayed.
    await http().post('/v1/auth/otp/verify').send({ phone, code }).expect(400);
  });

  it('rate-limits sends per phone (60 s) and per IP (5/hour)', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone }).expect(200);
    const again = await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', nextIp())
      .send({ phone })
      .expect(429);
    expect(again.body.error.code).toBe('OTP_RATE_LIMITED');
    expect(again.body.error.details.retryAfterSec).toBeGreaterThan(0);

    const shared = nextIp();
    for (let i = 0; i < 5; i++)
      await http()
        .post('/v1/auth/otp/send')
        .set('X-Forwarded-For', shared)
        .send({ phone: nextPhone() })
        .expect(200);
    const blocked = await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', shared)
      .send({ phone: nextPhone() })
      .expect(429);
    expect(blocked.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('locks a code after 5 attempts and rejects expired codes', async () => {
    const phone = nextPhone();
    await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', nextIp())
      .send({ phone })
      .expect(200);
    const code = lastCode(phone);
    for (let i = 0; i < 4; i++) {
      const r = await http()
        .post('/v1/auth/otp/verify')
        .send({ phone, code: wrong(code) })
        .expect(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    const fifth = await http()
      .post('/v1/auth/otp/verify')
      .send({ phone, code: wrong(code) })
      .expect(429);
    expect(fifth.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    const right = await http().post('/v1/auth/otp/verify').send({ phone, code }).expect(429);
    expect(right.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    const phone2 = nextPhone();
    await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', nextIp())
      .send({ phone: phone2 })
      .expect(200);
    await prisma.otpCode.updateMany({
      where: { phone: phone2 },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await http()
      .post('/v1/auth/otp/verify')
      .send({ phone: phone2, code: lastCode(phone2) })
      .expect(400);
    expect(expired.body.error.code).toBe('OTP_EXPIRED');
  });

  /** Closes the 60 s resend windows (and optionally the hourly ones) so caps behind them are reachable. */
  async function openWindows(scopes: string[] = ['otp:phone']) {
    const redis = app.get(RedisService);
    for (const scope of scopes) {
      const keys = await redis.keys(`rl:${scope}:*`);
      if (keys.length) await redis.del(...keys);
    }
  }
  const send = (phone: string) =>
    http().post('/v1/auth/otp/send').set('X-Forwarded-For', nextIp()).send({ phone });

  it('caps sends per phone: 5 per hour and 10 per day, whatever the IP', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 5; i++) {
      await openWindows();
      await send(phone).expect(200);
    }
    await openWindows();
    const hourly = await send(phone).expect(429);
    expect(hourly.body.error.code).toBe('OTP_RATE_LIMITED');

    const daily = nextPhone();
    for (let i = 0; i < 10; i++) {
      await openWindows(['otp:phone', 'otp:phone-hour']);
      await send(daily).expect(200);
    }
    await openWindows(['otp:phone', 'otp:phone-hour']);
    const blocked = await send(daily).expect(429);
    expect(blocked.body.error.code).toBe('OTP_RATE_LIMITED');
    expect(blocked.body.error.details.retryAfterSec).toBeGreaterThan(3600);
  });

  it('locks a phone for the day after 15 failed verifies (across codes)', async () => {
    const phone = nextPhone();
    for (let round = 0; round < 3; round++) {
      await openWindows();
      await send(phone).expect(200);
      const code = lastCode(phone);
      for (let i = 0; i < 5; i++)
        await http()
          .post('/v1/auth/otp/verify')
          .send({ phone, code: wrong(code) });
    }
    await openWindows();
    const resend = await send(phone).expect(429);
    expect(resend.body.error.code).toBe('OTP_LOCKED');
    const verify = await http()
      .post('/v1/auth/otp/verify')
      .send({ phone, code: '0000' })
      .expect(429);
    expect(verify.body.error.code).toBe('OTP_LOCKED');
    expect(verify.body.error.details.retryAfterSec).toBeGreaterThan(3600);
    // Another phone is unaffected.
    await login();
  });

  it('validates phone input with stable codes', async () => {
    const r = await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', nextIp())
      .send({ phone: '90 12' })
      .expect(400);
    expect(r.body.error.code).toBe('PHONE_INCOMPLETE');
    await http().post('/v1/auth/otp/verify').send({ phone: nextPhone(), code: '12a4' }).expect(400);
  });

  it('rotates the session on login, merges the anonymous cart, and logs out', async () => {
    const merger = app.get<CartMerger>(CART_MERGER);
    const spy = vi.spyOn(merger, 'mergeAnonymousCart');
    const first = await login();

    const phone = nextPhone();
    const ip = nextIp();
    await http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone }).expect(200);
    const res = await http()
      .post('/v1/auth/otp/verify')
      .set('Cookie', `${first.cookie}; fr_cart=anon-cart-0001`)
      .send({ phone, code: lastCode(phone) })
      .expect(200);
    const second = sessionCookie(res);
    expect(second).not.toBe(first.cookie);
    expect(spy).toHaveBeenLastCalledWith('anon-cart-0001', res.body.id);
    // The previous session id is dead after rotation.
    await http().get('/v1/me').set('Cookie', first.cookie).expect(401);
    await http().get('/v1/me').set('Cookie', second).expect(200);

    await http().post('/v1/auth/logout').set('Cookie', second).expect(204);
    await http().get('/v1/me').set('Cookie', second).expect(401);
    spy.mockRestore();
  });

  // ───────── /me ─────────

  it('updates profile name and locale', async () => {
    const { cookie } = await login();
    const r = await http()
      .patch('/v1/me')
      .set('Cookie', cookie)
      .send({ name: 'Dilnoza', locale: 'ru' })
      .expect(200);
    expect(r.body).toMatchObject({ name: 'Dilnoza', locale: 'ru' });
    await http().patch('/v1/me').set('Cookie', cookie).send({}).expect(400);
  });

  it('manages addresses with a single default and ownership checks', async () => {
    const { cookie } = await login();
    const a = await http()
      .post('/v1/me/addresses')
      .set('Cookie', cookie)
      .send({
        label: 'Uy',
        region: 'tashkent_city',
        district: 'chilonzor',
        line: 'Bunyodkor 12, 45-xonadon',
      })
      .expect(201);
    expect(a.body).toMatchObject({ label: 'Uy', isDefault: true });
    const b = await http()
      .post('/v1/me/addresses')
      .set('Cookie', cookie)
      .send({
        label: 'Dacha',
        region: 'tashkent_region',
        line: "Zangiota, Bog' ko'chasi 3",
        isDefault: true,
      })
      .expect(201);
    expect(b.body.isDefault).toBe(true);
    let list = await http().get('/v1/me/addresses').set('Cookie', cookie).expect(200);
    expect(list.body.map((x: { id: string; isDefault: boolean }) => [x.id, x.isDefault])).toEqual([
      [b.body.id, true],
      [a.body.id, false],
    ]);

    const upd = await http()
      .patch(`/v1/me/addresses/${a.body.id}`)
      .set('Cookie', cookie)
      .send({ line: 'Bunyodkor 14, 1-xonadon', isDefault: true })
      .expect(200);
    expect(upd.body).toMatchObject({
      line: 'Bunyodkor 14, 1-xonadon',
      isDefault: true,
      label: 'Uy',
    });

    await http()
      .post('/v1/me/addresses')
      .set('Cookie', cookie)
      .send({ region: 'atlantis', line: 'Somewhere 1' })
      .expect(400);

    const other = await login();
    await http()
      .patch(`/v1/me/addresses/${a.body.id}`)
      .set('Cookie', other.cookie)
      .send({ line: 'Hijack 12345' })
      .expect(404);
    await http().delete(`/v1/me/addresses/${a.body.id}`).set('Cookie', other.cookie).expect(404);

    await http().delete(`/v1/me/addresses/${a.body.id}`).set('Cookie', cookie).expect(204);
    list = await http().get('/v1/me/addresses').set('Cookie', cookie).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: b.body.id, isDefault: true })]);
    const me = await http().get('/v1/me').set('Cookie', cookie).expect(200);
    expect(me.body.addressesCount).toBe(1);
  });

  it('adds, lists and removes favorites as product cards', async () => {
    const { cookie } = await login();
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'chalk-white' } });
    await http()
      .post('/v1/me/favorites')
      .set('Cookie', cookie)
      .send({ productId: product.id })
      .expect(204);
    await http()
      .post('/v1/me/favorites')
      .set('Cookie', cookie)
      .send({ productId: product.id })
      .expect(204);
    await http()
      .post('/v1/me/favorites')
      .set('Cookie', cookie)
      .send({ productId: 'nope' })
      .expect(404);
    const list = await http().get('/v1/me/favorites').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ slug: 'chalk-white', priceFromSoum: expect.any(Number) });
    await http().delete(`/v1/me/favorites/${product.id}`).set('Cookie', cookie).expect(204);
    const empty = await http().get('/v1/me/favorites').set('Cookie', cookie).expect(200);
    expect(empty.body).toEqual([]);
  });

  it('keeps an append-only consent history with source cabinet', async () => {
    const { cookie, me } = await login();
    let r = await http()
      .patch('/v1/me/consents')
      .set('Cookie', cookie)
      .send({ smsMarketing: true })
      .expect(200);
    expect(r.body).toEqual({ smsMarketing: true, telegram: false, adsMatching: false });
    // Unchanged values add no rows.
    await http()
      .patch('/v1/me/consents')
      .set('Cookie', cookie)
      .send({ smsMarketing: true })
      .expect(200);
    r = await http()
      .patch('/v1/me/consents')
      .set('Cookie', cookie)
      .send({ smsMarketing: false, telegram: true })
      .expect(200);
    expect(r.body).toEqual({ smsMarketing: false, telegram: true, adsMatching: false });

    const rows = await prisma.consent.findMany({
      where: { customerId: me.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((x) => [x.channel, x.granted, x.source])).toEqual(
      expect.arrayContaining([
        ['SMS_MARKETING', true, 'cabinet'],
        ['SMS_MARKETING', false, 'cabinet'],
        ['TELEGRAM', true, 'cabinet'],
      ]),
    );
    const meRes = await http().get('/v1/me').set('Cookie', cookie).expect(200);
    expect(meRes.body.consents).toEqual({
      smsMarketing: false,
      telegram: true,
      adsMatching: false,
    });
  });

  it('exports own data and records an erasure request once', async () => {
    const { cookie, me, phone } = await login();
    await http()
      .patch('/v1/me/consents')
      .set('Cookie', cookie)
      .send({ adsMatching: true })
      .expect(200);
    const exp = await http().post('/v1/me/data-export').set('Cookie', cookie).expect(200);
    expect(exp.headers['content-disposition']).toContain('attachment');
    expect(exp.body.profile.phone).toBe(phone);
    expect(exp.body.consents).toEqual([
      expect.objectContaining({ channel: 'ADS_MATCHING', granted: true }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'customer.data_export', entityId: me.id } }),
    ).toBe(1);

    const del = await http().post('/v1/me/data-delete').set('Cookie', cookie).expect(202);
    const dueMs = new Date(del.body.dueBy).getTime() - new Date(del.body.requestedAt).getTime();
    expect(dueMs).toBe(30 * 86_400_000);
    const again = await http().post('/v1/me/data-delete').set('Cookie', cookie).expect(202);
    expect(again.body).toEqual(del.body);
    expect(
      await prisma.auditLog.count({
        where: { action: 'customer.erase_requested', entityId: me.id },
      }),
    ).toBe(1);
  });

  // ───────── Leads & waitlist ─────────

  it('captures a lead: customer, opt-in consent, promo SMS, signed bot link', async () => {
    const phone = nextPhone();
    const r = await http()
      .post('/v1/leads')
      .set('X-Forwarded-For', nextIp())
      .send({ phone, source: 'popup', marketingConsent: true })
      .expect(200);
    expect(r.body.promoCode).toBe('SALOM10');
    const link = new URL(r.body.telegramDeepLink);
    expect(`${link.origin}${link.pathname}`).toBe('https://t.me/forest_uz_bot');
    const token = link.searchParams.get('start')!;
    expect(token.length).toBeLessThanOrEqual(64);
    expect(verifyDeepLink(token, process.env.SESSION_SECRET!)).toEqual({
      kind: 'lead',
      src: 'popup',
    });

    const c = await prisma.customer.findUniqueOrThrow({
      where: { phone },
      include: { consents: true },
    });
    expect(c.leadSource).toBe('popup');
    expect(c.leadAt).not.toBeNull();
    expect(c.consents.map((x) => [x.channel, x.granted, x.source])).toEqual([
      ['SMS_MARKETING', true, 'popup'],
    ]);
    const sms = integrations.outbox.list(phone).filter((m) => m.templateKey === 'lead_promo_sms');
    expect(sms).toHaveLength(1);
    expect(sms[0]!.text).toContain('SALOM10');
    expect(
      await prisma.message.count({
        where: { customerId: c.id, templateKey: 'lead_promo_sms', status: 'SENT' },
      }),
    ).toBe(1);

    // Same answer for a known phone; no second SMS; first lead source kept.
    const again = await http()
      .post('/v1/leads')
      .set('X-Forwarded-For', nextIp())
      .send({ phone, source: 'footer' })
      .expect(200);
    expect(Object.keys(again.body).sort()).toEqual(['promoCode', 'telegramDeepLink']);
    expect(again.body.promoCode).toBe('SALOM10');
    expect(
      integrations.outbox.list(phone).filter((m) => m.templateKey === 'lead_promo_sms'),
    ).toHaveLength(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { phone } })).leadSource).toBe(
      'popup',
    );
  });

  it('records no consent without an explicit opt-in and rate-limits per IP', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await http()
      .post('/v1/leads')
      .set('X-Forwarded-For', ip)
      .send({ phone, source: 'selector' })
      .expect(200);
    const c = await prisma.customer.findUniqueOrThrow({
      where: { phone },
      include: { consents: true },
    });
    expect(c.consents).toEqual([]);
    for (let i = 0; i < 9; i++)
      await http()
        .post('/v1/leads')
        .set('X-Forwarded-For', ip)
        .send({ phone: nextPhone(), source: 'home' })
        .expect(200);
    const blocked = await http()
      .post('/v1/leads')
      .set('X-Forwarded-For', ip)
      .send({ phone: nextPhone(), source: 'home' })
      .expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('adds a waitlist entry idempotently per variant and phone', async () => {
    const phone = nextPhone();
    const variant = await prisma.variant.findFirstOrThrow({ where: { stock: 0 } });
    for (let i = 0; i < 2; i++)
      await http()
        .post('/v1/catalog/waitlist')
        .set('X-Forwarded-For', nextIp())
        .send({ variantId: variant.id, phone })
        .expect(200, { ok: true });
    const rows = await prisma.waitlistEntry.findMany({ where: { phone } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId: variant.id,
      productId: variant.productId,
      channel: 'SMS',
    });
    await http()
      .post('/v1/catalog/waitlist')
      .set('X-Forwarded-For', nextIp())
      .send({ variantId: 'missing', phone })
      .expect(404);
  });
});
