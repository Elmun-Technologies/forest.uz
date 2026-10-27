import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { TemplateSms } from '../src/customer/common/messaging';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, nextTestIp } from './app';

interface StubCall {
  path: string;
  auth: string | null;
  form: Record<string, string>;
}

/** Local stand-in for notify.eskiz.uz (shapes from the Postman collection examples). */
function eskizStub() {
  const calls: StubCall[] = [];
  let logins = 0;
  let sends = 0;
  const state = { rejectNextSend: false, password: 'eskiz-secret' };
  const valid = new Set<string>();
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => resolve(body));
    });
  const server: Server = createServer(async (req, res) => {
    const form = Object.fromEntries(new URLSearchParams(await read(req)));
    const auth = req.headers.authorization ?? null;
    calls.push({ path: req.url ?? '', auth, form });
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      if (form.password !== state.password) return reply(401, { message: 'Invalid credentials' });
      const token = `tok-${++logins}`;
      valid.add(token);
      return reply(200, { message: 'token_generated', data: { token }, token_type: 'bearer' });
    }
    if (req.method === 'POST' && req.url === '/api/message/sms/send') {
      const token = auth?.replace(/^Bearer /, '') ?? '';
      if (state.rejectNextSend) {
        // The token "expired": Eskiz rejects it until a new login.
        state.rejectNextSend = false;
        valid.delete(token);
      }
      if (!valid.has(token)) return reply(401, { message: 'Expired', status: 'token-expired' });
      return reply(200, {
        id: `00000000-0000-4000-8000-${String(++sends).padStart(12, '0')}`,
        message: 'Waiting for SMS provider',
        status: 'waiting',
      });
    }
    reply(404, { message: 'not found' });
  });
  return { server, calls, state, logins: () => logins };
}

describe('Eskiz SMS adapter + delivery callbacks (integration)', () => {
  const stub = eskizStub();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let integrations: IntegrationsService;
  let sms: TemplateSms;
  let ownerId: string;
  let callbackToken: string;
  let apiUrl: string;
  // Token cache keys are per account and Redis is shared by all suites: one account per run.
  const email = `shop-${Date.now()}@forest.test`;

  const http = () => request(app.getHttpServer());
  const sends = () => stub.calls.filter((c) => c.path === '/api/message/sms/send');
  const loginsSeen = () => stub.calls.filter((c) => c.path === '/api/auth/login').length;

  async function sendOrderSms(phone: string, attempts = 1) {
    const before = sends().length;
    await sms.send({
      phone,
      templateKey: 'order_created',
      locale: 'uz',
      vars: { raqam: 'F-10001', link: 'https://forest.test/t/abc' },
      record: true,
    });
    const providerId = (
      await prisma.message.findFirstOrThrow({
        where: { channel: 'SMS', providerId: { not: null }, templateKey: 'order_created' },
        orderBy: { createdAt: 'desc' },
      })
    ).providerId!;
    expect(sends().length).toBe(before + attempts);
    return providerId;
  }

  beforeAll(async () => {
    await new Promise<void>((r) => stub.server.listen(0, '127.0.0.1', r));
    const port = (stub.server.address() as AddressInfo).port;
    app = await createTestApp({
      PROVIDERS_MODE: 'sandbox',
      ESKIZ_API_URL: `http://127.0.0.1:${port}/api`,
    });
    apiUrl = app.get<Env>(ENV).API_URL;
    prisma = app.get(PrismaService);
    integrations = app.get(IntegrationsService);
    sms = app.get(TemplateSms);
    ownerId = (
      await prisma.staff.create({
        data: {
          email: `eskiz-owner-${Date.now()}@t.uz`,
          name: 'O',
          role: 'OWNER',
          passwordHash: 'x',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await integrations.disconnect('eskiz', ownerId, null);
    await app.close();
    await new Promise((r) => stub.server.close(r));
  });

  it('is not configured until connected (no silent fake in sandbox)', async () => {
    await integrations.disconnect('eskiz', ownerId, null);
    await expect(integrations.sms()).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
  });

  it('connect tests the login, stores a callback secret, and refuses bad credentials', async () => {
    const bad = await integrations.connect(
      'eskiz',
      { email, password: 'wrong', from: '4546' },
      ownerId,
      null,
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('Invalid credentials');
    expect((await prisma.integration.findUniqueOrThrow({ where: { key: 'eskiz' } })).status).toBe(
      'ERROR',
    );

    const ok = await integrations.connect(
      'eskiz',
      { email, password: stub.state.password, from: '4546' },
      ownerId,
      null,
    );
    expect(ok).toEqual({ ok: true, message: 'login ok' });
    const creds = await integrations.connectedCredentials('eskiz');
    callbackToken = creds!.callbackToken!;
    expect(callbackToken).toMatch(/^[\w-]{43}$/);
    // The secret is never shown in the admin view.
    const view = (await integrations.list()).find((v) => v.definition.key === 'eskiz')!;
    expect(JSON.stringify(view)).not.toContain(callbackToken);
  });

  it('sends with the cached token (no login per SMS), form fields and callback URL', async () => {
    const logins = loginsSeen();
    const id = await sendOrderSms('+998901234567');
    await sendOrderSms('+998901234568');
    expect(loginsSeen()).toBe(logins); // token from the connect test is reused
    const call = sends().at(-2)!;
    expect(call.form).toEqual({
      mobile_phone: '998901234567',
      message: 'Forest: buyurtma F-10001 qabul qilindi. Kuzatish: https://forest.test/t/abc',
      from: '4546',
      callback_url: `${apiUrl}/v1/webhooks/eskiz/${callbackToken}`,
    });
    expect(call.auth).toMatch(/^Bearer tok-\d+$/);
    const msg = await prisma.message.findFirstOrThrow({ where: { providerId: id } });
    expect(msg).toMatchObject({ status: 'SENT', channel: 'SMS' });
  });

  it('logs in again once on 401 and retries the send', async () => {
    const logins = loginsSeen();
    stub.state.rejectNextSend = true;
    await sendOrderSms('+998901234569', 2);
    expect(loginsSeen()).toBe(logins + 1);
    const [failed, retried] = sends().slice(-2);
    expect(failed!.auth).not.toBe(retried!.auth);
  });

  it('sends OTP codes through Eskiz end to end', async () => {
    const phone = '+998911234570';
    await http()
      .post('/v1/auth/otp/send')
      .set('X-Forwarded-For', nextTestIp())
      .send({ phone })
      .expect(200);
    const call = sends().at(-1)!;
    expect(call.form.mobile_phone).toBe('998911234570');
    expect(call.form.message).toMatch(/^Forest: kirish kodi \d{4}\./);
  });

  it('updates Message.status from callbacks idempotently (JSON and form bodies)', async () => {
    const id = await sendOrderSms('+998901234571');
    const cb = (body: object, token = callbackToken, form = false) => {
      const r = http().post(`/v1/webhooks/eskiz/${token}`);
      return form ? r.type('form').send(body) : r.send(body);
    };
    const payload = {
      request_id: id,
      message_id: '4385062',
      user_sms_id: '',
      country: 'UZ',
      phone_number: '998901234571',
      sms_count: '1',
      status: 'DELIVRD',
      status_date: '2026-10-27 10:00:00',
    };
    await cb({ ...payload, status: 'ACCEPTED' }).expect(200);
    expect((await prisma.message.findFirstOrThrow({ where: { providerId: id } })).status).toBe(
      'SENT',
    );
    expect((await cb(payload).expect(200)).body).toEqual({ ok: true });
    const delivered = await prisma.message.findFirstOrThrow({ where: { providerId: id } });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
    // Repeats and late contradicting statuses don't move a final state.
    await cb(payload).expect(200);
    await cb({ ...payload, status: 'REJECTD' }).expect(200);
    const still = await prisma.message.findFirstOrThrow({ where: { providerId: id } });
    expect(still.status).toBe('DELIVERED');
    expect(still.deliveredAt).toEqual(delivered.deliveredAt);

    const id2 = await sendOrderSms('+998901234572');
    await cb({ ...payload, request_id: id2, status: 'UNDELIV' }, callbackToken, true).expect(200);
    expect(await prisma.message.findFirstOrThrow({ where: { providerId: id2 } })).toMatchObject({
      status: 'FAILED',
      error: 'eskiz: UNDELIV',
    });
    // Unknown ids and junk are acknowledged (no retries) and change nothing.
    await cb({ ...payload, request_id: 'ffffffff-0000-4000-8000-000000000000' }).expect(200);
    await cb({ hello: 'world' }).expect(200);
    const log = await prisma.integrationLog.findFirstOrThrow({
      where: { integrationKey: 'eskiz', kind: 'webhook.status' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(log.payload)).not.toContain('998901234572');
  });

  it('rejects callbacks without the secret token', async () => {
    const id = await sendOrderSms('+998901234573');
    const body = {
      request_id: id,
      status: 'DELIVRD',
      phone_number: '998901234573',
      message_id: '1',
    };
    const wrong = callbackToken.slice(0, -1) + (callbackToken.endsWith('A') ? 'B' : 'A');
    await http().post(`/v1/webhooks/eskiz/${wrong}`).send(body).expect(404);
    await http().post('/v1/webhooks/eskiz/').send(body).expect(404);
    expect((await prisma.message.findFirstOrThrow({ where: { providerId: id } })).status).toBe(
      'SENT',
    );
    // Disconnected integration: every token is unknown.
    await integrations.disconnect('eskiz', ownerId, null);
    await http().post(`/v1/webhooks/eskiz/${callbackToken}`).send(body).expect(404);
  });
});
