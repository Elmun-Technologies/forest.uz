import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { telegramDataCheckString, telegramLoginHash } from '../src/customer/auth/telegram-login';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, nextTestIp, shopper } from './app';

const BOT_TOKEN = '7000000001:AAF-forest-test-bot-token_0123456789';

/** Signs like Telegram does (hash algorithm unit-tested against Python vectors). */
function widget(fields: Record<string, string | number>, token = BOT_TOKEN) {
  return { ...fields, hash: telegramLoginHash(telegramDataCheckString(fields)!, token) };
}

let tgSeq = 0;
const tgBase = 6_000_000_000 + Math.floor(Math.random() * 100_000_000);
const nextTgId = () => tgBase + ++tgSeq * 7;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('Telegram login widget + linking (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let ownerId: string;

  const http = () => request(app.getHttpServer());

  function sessionCookie(res: request.Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const c = raw?.find((x) => x.startsWith('fr_session='));
    if (!c) throw new Error('no session cookie');
    return c.split(';')[0]!;
  }

  const tgLogin = (payload: object, cookie?: string) => {
    const r = http().post('/v1/auth/telegram').set('X-Forwarded-For', nextTestIp());
    if (cookie) r.set('Cookie', cookie);
    return r.send(payload);
  };

  async function otpLogin(phone: string): Promise<string> {
    const ip = nextTestIp();
    await http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone }).expect(200);
    const code = integrations.outbox
      .list(phone)
      .find((m) => m.templateKey === 'otp')
      ?.text.match(/\b(\d{4})\b/)?.[1];
    const res = await http()
      .post('/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ phone, code })
      .expect(200);
    return sessionCookie(res);
  }

  const phoneBase = Math.floor(Math.random() * 9_000_000);
  let phoneSeq = 0;
  const nextPhone = () => `+99893${String((phoneBase + ++phoneSeq) % 10_000_000).padStart(7, '0')}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    ownerId = (
      await prisma.staff.create({
        data: { email: `tg-owner-${Date.now()}@t.uz`, name: 'O', role: 'OWNER', passwordHash: 'x' },
      })
    ).id;
  });
  afterAll(async () => {
    // Shared DB: leave the integration as other suites expect it.
    await integrations.disconnect('telegram', ownerId, null);
    await app.close();
  });

  it('is unavailable until the telegram integration is connected', async () => {
    await integrations.disconnect('telegram', ownerId, null);
    const res = await tgLogin(widget({ id: nextTgId(), first_name: 'A', auth_date: nowSec() }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    const settings = await http().get('/v1/settings/public').expect(200);
    expect(settings.body.auth).toEqual({ telegramBot: null });

    // Fake mode: connect stores the credentials without calling getMe.
    const health = await integrations.connect(
      'telegram',
      { botToken: BOT_TOKEN, botUsername: '@forest_test_bot' },
      ownerId,
      null,
    );
    expect(health.ok).toBe(true);
    const after = await http().get('/v1/settings/public').expect(200);
    expect(after.body.auth).toEqual({ telegramBot: 'forest_test_bot' });
  });

  it('logs in a new customer without a phone; /me copes', async () => {
    const id = nextTgId();
    const res = await tgLogin(
      widget({
        id,
        first_name: 'Malika',
        last_name: 'Karimova',
        username: 'malika_k',
        photo_url: 'https://t.me/i/userpic/320/x.jpg',
        auth_date: nowSec(),
      }),
    ).expect(200);
    expect(res.body).toMatchObject({
      phone: null,
      name: 'Malika Karimova',
      telegram: { username: 'malika_k' },
      ordersCount: 0,
    });
    const cookie = sessionCookie(res);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    const row = await prisma.customer.findUniqueOrThrow({ where: { telegramId: BigInt(id) } });
    expect(row).toMatchObject({ phone: null, telegramUsername: 'malika_k' });
    await http().get('/v1/me').set('Cookie', cookie).expect(200);
    const orders = await http().get('/v1/me/orders').set('Cookie', cookie).expect(200);
    expect(orders.body).toEqual([]);

    // Second login: same customer, username refreshed, new session (rotation).
    const again = await tgLogin(
      widget({ id, first_name: 'Malika', username: 'malika_new', auth_date: nowSec() }),
      cookie,
    ).expect(200);
    expect(again.body.id).toBe(row.id);
    expect(again.body.telegram).toEqual({ username: 'malika_new' });
    expect(again.body.name).toBe('Malika Karimova');
    const second = sessionCookie(again);
    expect(second).not.toBe(cookie);
    await http().get('/v1/me').set('Cookie', cookie).expect(401);
    await http().get('/v1/me').set('Cookie', second).expect(200);
  });

  it('merges the anonymous cart into the Telegram customer', async () => {
    const agent = shopper(app);
    const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: 'FR-RL-10' } });
    await agent.post('/v1/cart/items').send({ variantId: variant.id, qty: 2 }).expect(201);
    const res = await agent
      .post('/v1/auth/telegram')
      .send(widget({ id: nextTgId(), first_name: 'Sardor', auth_date: nowSec() }))
      .expect(200);
    const cart = await prisma.cart.findFirstOrThrow({
      where: { customerId: res.body.id, status: 'ACTIVE' },
      include: { items: true },
    });
    expect(cart.items).toEqual([expect.objectContaining({ variantId: variant.id, qty: 2 })]);
    const viaApi = await agent.get('/v1/cart').expect(200);
    expect(JSON.stringify(viaApi.body)).toContain(variant.id);
  });

  it('rejects a bad hash, another bot, stale and future auth_date, junk', async () => {
    const fields = { id: nextTgId(), first_name: 'X', auth_date: nowSec() };
    const tampered = { ...widget(fields), first_name: 'Y' };
    const bad = await tgLogin(tampered).expect(401);
    expect(bad.body.error.code).toBe('TELEGRAM_AUTH_INVALID');
    await tgLogin(widget(fields, '7000000002:AAF-other-bot-token_0123456789')).expect(401);

    const stale = await tgLogin(widget({ ...fields, auth_date: nowSec() - 86_401 })).expect(401);
    expect(stale.body.error.code).toBe('TELEGRAM_AUTH_EXPIRED');
    const future = await tgLogin(widget({ ...fields, auth_date: nowSec() + 600 })).expect(401);
    expect(future.body.error.code).toBe('TELEGRAM_AUTH_EXPIRED');

    expect((await tgLogin({ id: 1, auth_date: nowSec() }).expect(400)).body.error.field).toBe(
      'hash',
    );
    await tgLogin({ ...widget(fields), 'Bad-Key': 'x' }).expect(400);
    // Nothing was created for the rejected id.
    expect(await prisma.customer.count({ where: { telegramId: BigInt(fields.id) } })).toBe(0);
  });

  it('rate-limits per IP', async () => {
    const ip = nextTestIp();
    const payload = { id: 1, auth_date: nowSec(), hash: 'a'.repeat(64) };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push(
        (await http().post('/v1/auth/telegram').set('X-Forwarded-For', ip).send(payload)).status,
      );
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('links Telegram to an OTP customer; conflicts with another real customer', async () => {
    const phone = nextPhone();
    const cookie = await otpLogin(phone);
    const id = nextTgId();
    const linked = await http()
      .post('/v1/me/telegram/link')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', nextTestIp())
      .send(widget({ id, username: 'dilnoza', auth_date: nowSec() }))
      .expect(200);
    expect(linked.body).toMatchObject({ phone, telegram: { username: 'dilnoza' } });
    // Telegram login now lands in the same (phone) account.
    const viaTg = await tgLogin(widget({ id, auth_date: nowSec() })).expect(200);
    expect(viaTg.body).toMatchObject({ id: linked.body.id, phone });

    const other = await otpLogin(nextPhone());
    const conflict = await http()
      .post('/v1/me/telegram/link')
      .set('Cookie', other)
      .set('X-Forwarded-For', nextTestIp())
      .send(widget({ id, auth_date: nowSec() }))
      .expect(409);
    expect(conflict.body.error.code).toBe('TELEGRAM_ALREADY_LINKED');
    await http()
      .post('/v1/me/telegram/link')
      .set('X-Forwarded-For', nextTestIp())
      .send(widget({ id, auth_date: nowSec() }))
      .expect(401);
    await http()
      .post('/v1/me/telegram/link')
      .set('Cookie', other)
      .set('X-Forwarded-For', nextTestIp())
      .send({ ...widget({ id: nextTgId(), auth_date: nowSec() }), id: 5 })
      .expect(401);
  });

  it('absorbs a phone-less Telegram-only customer when its account is linked', async () => {
    const id = nextTgId();
    const stubLogin = await tgLogin(widget({ id, first_name: 'Aziz', auth_date: nowSec() })).expect(
      200,
    );
    const stubCookie = sessionCookie(stubLogin);
    const product = await prisma.product.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    await http()
      .post('/v1/me/favorites')
      .set('Cookie', stubCookie)
      .send({ productId: product.id })
      .expect(204);

    const phone = nextPhone();
    const cookie = await otpLogin(phone);
    const res = await http()
      .post('/v1/me/telegram/link')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', nextTestIp())
      .send(widget({ id, auth_date: nowSec() }))
      .expect(200);
    expect(res.body).toMatchObject({ phone, telegram: { username: null }, favoritesCount: 1 });
    const stub = await prisma.customer.findUniqueOrThrow({ where: { id: stubLogin.body.id } });
    expect(stub.telegramId).toBeNull();
    expect(stub.deletedAt).not.toBeNull();
    // The stub's old session is dead.
    await http().get('/v1/me').set('Cookie', stubCookie).expect(401);
  });
});
