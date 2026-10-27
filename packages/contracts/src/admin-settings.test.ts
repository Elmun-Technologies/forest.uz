import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deliveryPromisePreview, STOREFRONT_PROMISE_TEMPLATES } from './admin-settings';
import type { DeliveryZone } from './delivery';
import { deliverySettingsInputSchema, storeSettingsInputSchema } from './schemas/admin-settings';
import { fromTashkent } from './time';

const here = dirname(fileURLToPath(import.meta.url));

const express: DeliveryZone = {
  key: 'tashkent-city-yandex',
  name: { uz: 'Toshkent shahri', ru: 'Ташкент' },
  carrier: 'YANDEX',
  regions: ['tashkent_city'],
  priceSoum: 30_000,
  freeFromSoum: 500_000,
  etaLabel: { uz: '12 soat ichida', ru: 'в течение 12 часов' },
  rule: {
    promiseHours: 12,
    cutoff: '18:00',
    sameDayEnd: '23:59',
    afterCutoffBy: '12:00',
    workDays: [0, 1, 2, 3, 4, 5, 6],
  },
  liveQuote: false,
  active: true,
  sort: 1,
};
const regions: DeliveryZone = {
  key: 'regions-bts',
  name: { uz: 'Viloyatlar', ru: 'Регионы' },
  carrier: 'BTS',
  regions: ['samarkand'],
  priceSoum: 45_000,
  freeFromSoum: 700_000,
  etaLabel: { uz: '24 soat ichida', ru: 'в течение 24 часов' },
  rule: { promiseHours: 48, workDays: [0, 1, 2, 3, 4, 5, 6] },
  active: true,
  sort: 2,
};

describe('storefront promise templates', () => {
  it('match the web messages (cartPage + product, <b> tags dropped)', () => {
    for (const lang of ['uz', 'ru'] as const) {
      const messages = JSON.parse(
        readFileSync(resolve(here, `../../../apps/web/messages/${lang}.json`), 'utf8'),
      ) as Record<string, Record<string, string>>;
      const t = STOREFRONT_PROMISE_TEMPLATES[lang];
      for (const k of ['etaToday', 'etaTomorrow', 'etaGeneric'] as const)
        expect(t[k]).toBe(messages.cartPage![k]);
      for (const k of ['deliveryToday', 'deliveryTomorrow', 'deliveryGeneric'] as const)
        expect(t[k]).toBe(messages.product![k]!.replace(/<\/?b>/g, ''));
    }
  });
});

describe('deliveryPromisePreview', () => {
  it('before the cut-off: same day, capped by sameDayEnd', () => {
    const at = fromTashkent(2026, 10, 27, 14, 0);
    const p = deliveryPromisePreview([regions, express], at);
    expect(p.zones.map((z) => z.zoneKey)).toEqual(['tashkent-city-yandex', 'regions-bts']);
    expect(p.zones[0]).toMatchObject({ day: 'today', promiseKind: 'SAME_DAY' });
    expect(p.zones[0]!.text.uz).toBe('Toshkent shahri: bugun 23:59 gacha');
    expect(p.zones[0]!.text.ru).toBe('Ташкент: сегодня до 23:59');
    expect(p.express?.text.uz).toBe(
      'Hozir buyurtma bersangiz, Toshkentda bugun 23:59 gacha yetkaziladi',
    );
    // 48 h → beyond tomorrow: the zone's ETA label, like the cart.
    expect(p.zones[1]!.text.uz).toBe('Viloyatlar: 24 soat ichida');
  });

  it('after the cut-off: next day by afterCutoffBy', () => {
    const p = deliveryPromisePreview([express], fromTashkent(2026, 10, 27, 19, 30));
    expect(p.zones[0]!.text.uz).toBe('Toshkent shahri: ertaga 12:00 gacha');
    expect(p.express?.text.ru).toBe('Закажите сейчас — доставим по Ташкенту завтра до 12:00');
  });

  it('no active express zone → no product line; broken rules are skipped', () => {
    const p = deliveryPromisePreview(
      [
        { ...express, active: false },
        { ...express, key: 'broken', rule: { ...express.rule, workDays: [] } },
      ],
      fromTashkent(2026, 10, 27, 10, 0),
    );
    expect(p.express).toBeNull();
    expect(p.zones.map((z) => z.zoneKey)).toEqual(['tashkent-city-yandex']);
  });
});

describe('delivery settings input', () => {
  const valid = {
    zones: [express, regions],
    rules: {
      codMaxSoum: 3_000_000,
      codAutoCancelHours: 24,
      onlineReservationMinutes: 30,
      paymentReminderMinutes: 15,
    },
    returns: { returnDays: 14, defectReportHours: 48, refundBusinessDays: '3–10' },
    version: 'v1',
  };

  it('accepts the seed-like document', () => {
    expect(deliverySettingsInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['duplicate keys', { zones: [express, { ...regions, key: express.key }] }],
    ['unknown region', { zones: [{ ...regions, regions: ['mars'] }] }],
    ['bad time', { zones: [{ ...express, rule: { ...express.rule, cutoff: '25:00' } }] }],
    [
      'sameDayEnd without cutoff',
      { zones: [{ ...regions, rule: { ...regions.rule, sameDayEnd: '23:00' } }] },
    ],
    ['liveQuote on BTS', { zones: [{ ...regions, liveQuote: true }] }],
    ['no active zone', { zones: [{ ...express, active: false }] }],
    ['negative price', { zones: [{ ...express, priceSoum: -1 }] }],
  ])('rejects %s', (_label, patch) => {
    expect(deliverySettingsInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('store settings input', () => {
  const value = {
    name: 'Forest',
    domain: 'forest.uz',
    phone: '+998998202277',
    email: 'info@forest.uz',
    hours: { uz: 'Har kuni', ru: 'Ежедневно' },
    telegramBot: '@forest_uz_bot',
    instagram: '',
    languages: ['uz', 'ru'],
    currency: 'UZS',
    dataLocation: "O'zbekiston",
    legal: { entityName: ' ', stir: '', address: null, bank: null, mfo: null, account: null },
    offerVersion: '2026-10-26-draft',
    deletionSlaDays: 30,
  };

  it('normalises blanks to null and strips @', () => {
    const r = storeSettingsInputSchema.parse({ value, version: 'x' });
    expect(r.value.legal.entityName).toBeNull();
    expect(r.value.legal.stir).toBeNull();
    expect(r.value.telegramBot).toBe('forest_uz_bot');
    expect(r.value.instagram).toBeNull();
  });

  it('validates STIR, account and the 30-day deletion SLA', () => {
    const bad = (patch: object) =>
      storeSettingsInputSchema.safeParse({ value: { ...value, ...patch }, version: 'x' }).success;
    expect(bad({ legal: { ...value.legal, stir: '12345' } })).toBe(false);
    expect(bad({ legal: { ...value.legal, account: '2020 8000 1234 5678 9012' } })).toBe(true);
    expect(bad({ deletionSlaDays: 31 })).toBe(false);
    expect(bad({ email: 'nope' })).toBe(false);
  });
});
