import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { createTestApp } from './app';

describe('IntegrationsService (integration)', () => {
  let app: NestExpressApplication;
  let svc: IntegrationsService;
  let prisma: PrismaService;
  let ownerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    svc = app.get(IntegrationsService);
    prisma = app.get(PrismaService);
    ownerId = (
      await prisma.staff.create({
        data: { email: `owner-${Date.now()}@t.uz`, name: 'O', role: 'OWNER', passwordHash: 'x' },
      })
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists all 48 registry entries with launch kit flags', async () => {
    const list = await svc.list();
    // 46 from the design + Phase 4: PageSpeed Insights (A9 lab CWV), Yandex Audiences (A8).
    expect(list).toHaveLength(48);
    expect(list.filter((i) => i.definition.launchKit)).toHaveLength(12);
    expect(list.find((i) => i.definition.key === 'uzum_nasiya')?.status).toBe('COMING_SOON');
  });

  it('stores credentials encrypted, masks them, keeps blank secrets, and audits changes', async () => {
    await svc.connect(
      'payme',
      { merchantId: 'm-123', key: 'super-secret-key-9f2a', mode: 'test' },
      ownerId,
      '127.0.0.1',
    );
    const row = await prisma.integration.findUniqueOrThrow({ where: { key: 'payme' } });
    expect(Buffer.from(row.credentials!).toString('utf8')).not.toContain('super-secret');
    expect(row.status).toBe('CONNECTED');

    const view = (await svc.list()).find((i) => i.definition.key === 'payme')!;
    expect(view.fields).toMatchObject({ merchantId: 'm-123', key: '•••• •••• 9f2a' });
    expect(view.usingFake).toBe(true);

    // Re-saving with an empty secret keeps the stored one.
    await svc.connect('payme', { merchantId: 'm-456', key: '', mode: 'live' }, ownerId, null);
    expect(await svc.credentials('payme')).toMatchObject({
      merchantId: 'm-456',
      key: 'super-secret-key-9f2a',
      mode: 'live',
    });

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Integration', entityId: 'payme' },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('super-secret');
  });

  it('rejects missing required fields and unknown/coming-soon integrations', async () => {
    await expect(svc.connect('click', { serviceId: '1' }, ownerId, null)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(svc.connect('uzum_nasiya', {}, ownerId, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('writes redacted integration logs', async () => {
    await svc.log('moysklad', {
      direction: 'OUT',
      kind: 'order.push',
      ok: true,
      message: 'ok',
      payload: { phone: '+998901234567', name: 'x' },
    });
    const log = await prisma.integrationLog.findFirstOrThrow({
      where: { integrationKey: 'moysklad' },
    });
    expect(log.payload).toEqual({ phone: '[redacted]', name: 'x' });
  });

  it('disconnect clears credentials', async () => {
    await svc.disconnect('payme', ownerId, null);
    expect(await svc.credentials('payme')).toEqual({});
  });

  it('fake providers capture SMS in the outbox', async () => {
    const sms = await svc.sms();
    await sms.send({
      phone: '+998901234567',
      text: 'Forest: kirish kodi 4711',
      templateKey: 'otp',
    });
    expect(svc.outbox.list('+998901234567')[0]?.text).toContain('4711');
  });
});
