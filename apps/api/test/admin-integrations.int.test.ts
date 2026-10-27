import { randomBytes } from 'node:crypto';
import type {
  IntegrationDetailDto,
  IntegrationsHubDto,
  IntegrationTestResultDto,
  StaffRole,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

async function put(c: AdminClient, path: string, body: object) {
  if (!c.csrf) await c.get('/v1/admin/auth/csrf');
  return c.agent.put(path).set('X-Forwarded-For', c.ip).set('X-CSRF-Token', c.csrf!).send(body);
}

/** Integration rows this suite touches, restored afterwards (the DB is shared by all suites). */
const TOUCHED = ['google_sheets', 'eskiz', 'claude'];

describe('admin integrations hub A10 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  let saved: Prisma.IntegrationGetPayload<object>[] = [];
  const secret = `gs-${randomBytes(12).toString('hex')}`;

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const)
      clients.set(role, (await signedIn(app, role)).client);
    saved = await prisma.integration.findMany({ where: { key: { in: TOUCHED } } });
  });
  afterAll(async () => {
    await prisma.integrationLog.deleteMany({
      where: { integrationKey: { in: ['google_sheets', 'claude'] } },
    });
    await prisma.integration.deleteMany({
      where: { key: { in: TOUCHED.filter((k) => !saved.some((s) => s.key === k)) } },
    });
    for (const s of saved)
      await prisma.integration.update({
        where: { key: s.key },
        data: {
          status: s.status,
          credentials: s.credentials,
          lastError: s.lastError,
          lastCheckAt: s.lastCheckAt,
        },
      });
    await app.close();
  });

  it('RBAC: hub for Owner/Manager only', async () => {
    for (const [role, status] of [
      ['OWNER', 200],
      ['MANAGER', 200],
      ['OPERATOR', 403],
      ['WAREHOUSE', 403],
      ['MARKETER', 403],
    ] as const) {
      expect((await clients.get(role)!.get('/v1/admin/integrations')).status).toBe(status);
      expect((await clients.get(role)!.get('/v1/admin/integrations/payme')).status).toBe(status);
    }
  });

  it('lists the registry with counts and launch-kit progress', async () => {
    const hub = (await clients.get('MANAGER')!.get('/v1/admin/integrations'))
      .body as IntegrationsHubDto;
    expect(hub.total).toBe(hub.items.length);
    expect(hub.items.length).toBeGreaterThanOrEqual(46);
    expect(hub.connected).toBe(hub.items.filter((i) => i.status === 'CONNECTED').length);
    expect(hub.launchKit.total).toBe(hub.items.filter((i) => i.launchKit).length);
    expect(hub.fakeMode).toBe(true);
    const by = new Map(hub.items.map((i) => [i.key, i]));
    expect(by.get('bts')).toMatchObject({ ready: true });
    expect(by.get('cod')).toMatchObject({ ready: true, readyNote: { kind: 'cod', enabled: true } });
    expect(by.get('ikpu')!.readyNote).toMatchObject({ kind: 'ikpu' });
    expect(by.get('moysklad')).toMatchObject({ dedicatedPage: '/moysklad', connectable: false });
    expect(by.get('uzum_nasiya')).toMatchObject({ status: 'COMING_SOON', connectable: false });
    expect((await clients.get('OWNER')!.get('/v1/admin/integrations/nope')).status).toBe(404);
  });

  it('Owner connects: secrets stored encrypted, only last 4 returned; Manager cannot', async () => {
    const body = { fields: { serviceAccountJson: secret, spreadsheetId: 'sheet-1' } };
    const denied = await put(clients.get('MANAGER')!, '/v1/admin/integrations/google_sheets', body);
    expect(denied.status).toBe(403);

    const owner = clients.get('OWNER')!;
    const res = await put(owner, '/v1/admin/integrations/google_sheets', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as IntegrationTestResultDto).status).toBe('CONNECTED');

    const detail = (await clients.get('MANAGER')!.get('/v1/admin/integrations/google_sheets'))
      .body as IntegrationDetailDto;
    expect(JSON.stringify(detail)).not.toContain(secret);
    const f = Object.fromEntries(detail.fields.map((x) => [x.key, x.value]));
    expect(f.serviceAccountJson).toBe(`•••• •••• ${secret.slice(-4)}`);
    expect(f.spreadsheetId).toBe('sheet-1');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'integration.update', entityId: 'google_sheets' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit)).not.toContain(secret);

    // Blank secret keeps the stored one.
    const again = await put(owner, '/v1/admin/integrations/google_sheets', {
      fields: { serviceAccountJson: '', spreadsheetId: 'sheet-2' },
    });
    expect(again.status).toBe(200);
    const row = await prisma.integration.findUniqueOrThrow({ where: { key: 'google_sheets' } });
    expect(Buffer.from(row.credentials!).toString('utf8')).not.toContain(secret);

    const unknown = await put(owner, '/v1/admin/integrations/google_sheets', {
      fields: { nope: 'x' },
    });
    expect(unknown.status).toBe(400);
    const badSelect = await put(owner, '/v1/admin/integrations/payme', {
      fields: { mode: 'prod' },
    });
    expect(badSelect.status).toBe(400);
    const dedicated = await put(owner, '/v1/admin/integrations/moysklad', { fields: {} });
    expect(dedicated.body.error.code).toBe('INTEGRATION_NOT_CONNECTABLE');
    const soon = await put(owner, '/v1/admin/integrations/uzum_nasiya', { fields: {} });
    expect(soon.body.error.code).toBe('INTEGRATION_NOT_CONNECTABLE');
  });

  it('test: Manager may run it; result recorded in log and audit', async () => {
    const m = clients.get('MANAGER')!;
    const res = await m.post('/v1/admin/integrations/google_sheets/test');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'CONNECTED' });
    expect(
      await prisma.integrationLog.count({
        where: { integrationKey: 'google_sheets', kind: 'health.check' },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'integration.test', entityId: 'google_sheets' },
      }),
    ).toBeGreaterThan(0);
    const notConnected = await m.post('/v1/admin/integrations/claude/test');
    expect(notConnected.status).toBe(503);
    expect(notConnected.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });

  it('logs are redacted', async () => {
    await prisma.integration.upsert({
      where: { key: 'claude' },
      update: {},
      create: { key: 'claude' },
    });
    await prisma.integrationLog.create({
      data: {
        integrationKey: 'claude',
        direction: 'OUT',
        kind: 'draft',
        ok: false,
        message: 'failed for +998 90 123 45 67',
        payload: { token: 'tok-very-secret', note: 'call +998901234567' },
      },
    });
    const d = (await clients.get('MANAGER')!.get('/v1/admin/integrations/claude'))
      .body as IntegrationDetailDto;
    const json = JSON.stringify(d.logs);
    expect(json).not.toContain('tok-very-secret');
    expect(json).not.toContain('901234567');
    expect(json).not.toContain('123 45 67');
  });

  it('webhook URLs: plain ones for viewers, secret ones Owner-only with audit', async () => {
    const m = clients.get('MANAGER')!;
    const payme = (await m.get('/v1/admin/integrations/payme')).body as IntegrationDetailDto;
    expect(payme.webhook).toMatchObject({ secret: false });
    expect(payme.webhook!.url).toMatch(/\/v1\/webhooks\/payme$/);
    const click = (await m.get('/v1/admin/integrations/click')).body as IntegrationDetailDto;
    expect(click.webhook!.urls.map((u) => u.split('/').pop())).toEqual(['prepare', 'complete']);

    const owner = clients.get('OWNER')!;
    const connect = await put(owner, '/v1/admin/integrations/eskiz', {
      fields: {
        email: 'sms@forest.test',
        password: `pw-${randomBytes(6).toString('hex')}`,
        from: '4546',
      },
    });
    expect(connect.status, JSON.stringify(connect.body)).toBe(200);
    const eskiz = (await m.get('/v1/admin/integrations/eskiz')).body as IntegrationDetailDto;
    expect(eskiz.webhook).toMatchObject({ url: null, secret: true, automatic: true });

    expect((await m.post('/v1/admin/integrations/eskiz/webhook-url')).status).toBe(403);
    const reveal = await owner.post('/v1/admin/integrations/eskiz/webhook-url');
    expect(reveal.status).toBe(200);
    expect(reveal.body.url).toMatch(/\/v1\/webhooks\/eskiz\/[\w-]{20,}$/);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'integration.view_secret', entityId: 'eskiz' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit)).not.toContain(reveal.body.url.split('/').pop());
    const yandex = await owner.post('/v1/admin/integrations/yandex_delivery/webhook-url');
    expect(yandex.body.url).toMatch(/\/v1\/webhooks\/yandex-delivery\?key=\w+/);
    expect((await owner.post('/v1/admin/integrations/payme/webhook-url')).status).toBe(404);
  });

  it('disconnect: Owner with typed confirmation; Manager denied', async () => {
    expect(
      (
        await clients
          .get('MANAGER')!
          .post('/v1/admin/integrations/google_sheets/disconnect', { confirm: 'google_sheets' })
      ).status,
    ).toBe(403);
    const owner = clients.get('OWNER')!;
    const wrong = await owner.post('/v1/admin/integrations/google_sheets/disconnect', {
      confirm: 'google',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('ADMIN_CONFIRM_MISMATCH');
    const ok = await owner.post('/v1/admin/integrations/google_sheets/disconnect', {
      confirm: 'google_sheets',
    });
    expect(ok.status).toBe(200);
    const row = await prisma.integration.findUniqueOrThrow({ where: { key: 'google_sheets' } });
    expect(row).toMatchObject({ status: 'DISCONNECTED', credentials: null });
    expect(
      await prisma.auditLog.count({
        where: { action: 'integration.disconnect', entityId: 'google_sheets' },
      }),
    ).toBeGreaterThan(0);
  });

  it('blank non-secret field clears it; blank secret keeps the stored one', async () => {
    const owner = clients.get('OWNER')!;
    const apiKey = `sk-${randomBytes(10).toString('hex')}`;
    expect(
      (await put(owner, '/v1/admin/integrations/claude', { fields: { apiKey, model: 'claude-x' } }))
        .status,
    ).toBe(200);
    const res = await put(owner, '/v1/admin/integrations/claude', {
      fields: { apiKey: '', model: '' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = (await owner.get('/v1/admin/integrations/claude')).body as IntegrationDetailDto;
    const f = Object.fromEntries(d.fields.map((x) => [x.key, x.value]));
    expect(f.model).toBeNull();
    expect(f.apiKey).toBe(`•••• •••• ${apiKey.slice(-4)}`);
  });
});
