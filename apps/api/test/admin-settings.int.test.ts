import type {
  DeliveryPreviewDto,
  DeliverySettingsDto,
  PublicSettingsDto,
  StaffRole,
  StoreSettingsDto,
} from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Prisma } from '@forest/db';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';

/** PUT with the CSRF header (AdminClient has helpers for post/patch/delete only). */
async function put(c: AdminClient, path: string, body: object) {
  if (!c.csrf) await c.get('/v1/admin/auth/csrf');
  return c.agent.put(path).set('X-Forwarded-For', c.ip).set('X-CSRF-Token', c.csrf!).send(body);
}

describe('admin settings A16 store/delivery (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const clients = new Map<StaffRole, AdminClient>();
  let saved: { key: string; value: Prisma.JsonValue }[] = [];

  beforeAll(async () => {
    app = await createAdminTestApp();
    prisma = app.get(PrismaService);
    for (const role of ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const)
      clients.set(role, (await signedIn(app, role)).client);
    saved = await prisma.setting.findMany({
      where: { key: { in: ['store.info', 'delivery.zones', 'delivery.rules', 'returns.rules'] } },
      select: { key: true, value: true },
    });
  });
  afterAll(async () => {
    // Other suites share this DB: put the seeded values back.
    for (const s of saved)
      await prisma.setting.update({
        where: { key: s.key },
        data: { value: s.value as Prisma.InputJsonValue },
      });
    await app.close();
  });

  it('RBAC: store = Owner; delivery = Owner/Manager', async () => {
    const table: [StaffRole, number, number][] = [
      ['OWNER', 200, 200],
      ['MANAGER', 403, 200],
      ['OPERATOR', 403, 403],
      ['WAREHOUSE', 403, 403],
      ['MARKETER', 403, 403],
    ];
    for (const [role, store, delivery] of table) {
      const c = clients.get(role)!;
      expect((await c.get('/v1/admin/settings/store')).status).toBe(store);
      expect((await c.get('/v1/admin/settings/delivery')).status).toBe(delivery);
    }
    const m = clients.get('MANAGER')!;
    const doc = (await m.get('/v1/admin/settings/delivery')).body as DeliverySettingsDto;
    const res = await put(m, '/v1/admin/settings/store', { value: {}, version: doc.version });
    expect(res.status).toBe(403);
  });

  it('delivery: saves a zone price, audits before/after, storefront and cart quote see it', async () => {
    const m = clients.get('MANAGER')!;
    const doc = (await m.get('/v1/admin/settings/delivery')).body as DeliverySettingsDto;
    const zone = doc.zones.find((z) => z.carrier === 'YANDEX')!;
    const zones = doc.zones.map((z) => (z.key === zone.key ? { ...z, priceSoum: 27_000 } : z));
    const res = await put(m, '/v1/admin/settings/delivery', { ...doc, zones });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = res.body as DeliverySettingsDto;
    expect(after.zones.find((z) => z.key === zone.key)!.priceSoum).toBe(27_000);
    expect(after.version).not.toBe(doc.version);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'settings.delivery.update' },
      orderBy: { createdAt: 'desc' },
    });
    const before = audit.before as Record<string, { key: string; priceSoum: number }[]>;
    const changed = audit.after as Record<string, { key: string; priceSoum: number }[]>;
    expect(Object.keys(changed)).toEqual(['delivery.zones']); // rules/returns unchanged
    expect(before['delivery.zones']!.find((z) => z.key === zone.key)!.priceSoum).toBe(
      zone.priceSoum,
    );
    expect(changed['delivery.zones']!.find((z) => z.key === zone.key)!.priceSoum).toBe(27_000);

    const pub = (await request(app.getHttpServer()).get('/v1/settings/public'))
      .body as PublicSettingsDto;
    expect(pub.delivery.zones.find((z) => z.key === zone.key)!.priceSoum).toBe(27_000);
    const quote = await request(app.getHttpServer()).get('/v1/cart/quote?region=tashkent_city');
    expect(quote.status).toBe(200);
    expect(
      (quote.body as { zoneKey: string; priceSoum: number }[]).find((o) => o.zoneKey === zone.key)!
        .priceSoum,
    ).toBe(27_000);
  });

  it('delivery: stale version → SETTINGS_CONFLICT; invalid documents → 400 without writes', async () => {
    const o = clients.get('OWNER')!;
    const doc = (await o.get('/v1/admin/settings/delivery')).body as DeliverySettingsDto;
    const stale = await put(o, '/v1/admin/settings/delivery', { ...doc, version: 'old' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('SETTINGS_CONFLICT');
    const dup = await put(o, '/v1/admin/settings/delivery', {
      ...doc,
      zones: [...doc.zones, doc.zones[0]],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('VALIDATION_FAILED');
    const badTime = await put(o, '/v1/admin/settings/delivery', {
      ...doc,
      zones: doc.zones.map((z) => ({
        ...z,
        rule: { ...z.rule, cutoff: '18:00', afterCutoffBy: '27:00' },
      })),
    });
    expect(badTime.status).toBe(400);
    const now = (await o.get('/v1/admin/settings/delivery')).body as DeliverySettingsDto;
    expect(now.version).toBe(doc.version);
  });

  it('delivery preview: storefront texts for a given time', async () => {
    const m = clients.get('MANAGER')!;
    // 2026-10-27 09:00 Tashkent (before the 18:00 cut-off) and 20:00 (after).
    const before = (await m.get('/v1/admin/settings/delivery/preview?at=2026-10-27T04:00:00Z'))
      .body as DeliveryPreviewDto;
    expect(before.express?.text.uz).toBe(
      'Hozir buyurtma bersangiz, Toshkentda bugun 21:00 gacha yetkaziladi',
    );
    expect(before.zones.find((z) => z.carrier === 'YANDEX')!.text.uz).toMatch(
      /: bugun 21:00 gacha$/,
    );
    const late = (await m.get('/v1/admin/settings/delivery/preview?at=2026-10-27T15:00:00Z'))
      .body as DeliveryPreviewDto;
    expect(late.express?.text.ru).toBe('Закажите сейчас — доставим по Ташкенту завтра до 12:00');
    const bad = await m.get('/v1/admin/settings/delivery/preview?at=yesterday');
    expect(bad.status).toBe(400);
    expect((await clients.get('OPERATOR')!.get('/v1/admin/settings/delivery/preview')).status).toBe(
      403,
    );
  });

  it('store: validates, stores blank legal fields as null, completing legal data ends the draft', async () => {
    const o = clients.get('OWNER')!;
    const doc = (await o.get('/v1/admin/settings/store')).body as StoreSettingsDto;
    expect(doc.legalComplete).toBe(false);
    const invalid = await put(o, '/v1/admin/settings/store', {
      version: doc.version,
      value: { ...doc.value, deletionSlaDays: 45 },
    });
    expect(invalid.status).toBe(400);

    const legal = {
      entityName: '"Forest Trade" MChJ',
      stir: '305123456',
      address: "Toshkent, Yunusobod, Amir Temur ko'chasi 1",
      bank: 'Kapitalbank',
      mfo: '01158',
      account: '2020 8000 1051 2345 6001',
    };
    const res = await put(o, '/v1/admin/settings/store', {
      version: doc.version,
      value: { ...doc.value, legal, offerVersion: '2026-10-27', telegramBot: '@forest_uz_bot' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = res.body as StoreSettingsDto;
    expect(saved.legalComplete).toBe(true);
    expect(saved.value.legal.account).toBe('20208000105123456001');
    expect(saved.value.offerVersion).toBe('2026-10-27');

    const pub = (await request(app.getHttpServer()).get('/v1/settings/public'))
      .body as PublicSettingsDto;
    expect(pub.store).toMatchObject({ legalComplete: true, offerVersion: '2026-10-27' });
    const page = await request(app.getHttpServer()).get('/v1/content/pages/legal/oferta?locale=uz');
    expect(page.status).toBe(200);
    expect(page.body.draft).toBe(false);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'settings.store.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit.before as Record<string, unknown>)['store.info']).toBeTruthy();
    expect((audit.after as Record<string, unknown>)['store.info']).toBeTruthy();

    // Blank legal input → null again (pages back to draft).
    const blank = await put(o, '/v1/admin/settings/store', {
      version: saved.version,
      value: { ...saved.value, legal: { ...legal, stir: '  ' } },
    });
    expect(blank.status).toBe(200);
    expect((blank.body as StoreSettingsDto).value.legal.stir).toBeNull();
    expect((blank.body as StoreSettingsDto).legalComplete).toBe(false);
  });
});
