import { UZ_REGIONS, type SettingKey, type SettingValue } from '@forest/contracts';

const allWeek = [0, 1, 2, 3, 4, 5, 6];
const regionsExceptTashkentCity = UZ_REGIONS.map((r) => r.code).filter(
  (c) => c !== 'tashkent_city',
);

/**
 * Defaults marked [confirm] in docs/02 — the owner changes them in admin A16.
 * Contradictions in the design (35 000 vs 30 000 Tashkent price, 18:00 vs 19:00 cut-off)
 * are resolved to the docs values and listed in docs/13-open-questions.md.
 */
export const settings: { [K in SettingKey]: SettingValue<K> } = {
  'store.info': {
    name: 'Forest',
    domain: 'forest.uz',
    phone: '+998998202277',
    email: 'info@forest.uz',
    hours: { uz: 'Har kuni 9:00–20:00', ru: 'Ежедневно 9:00–20:00' },
    telegramBot: 'forest_uz_bot',
    instagram: null,
    languages: ['uz', 'ru'],
    currency: 'UZS',
    dataLocation: "O'zbekiston",
    legal: { entityName: null, stir: null, address: null, bank: null, mfo: null, account: null },
    offerVersion: '2026-10-26-draft',
    deletionSlaDays: 30,
  },
  'delivery.zones': [
    {
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
        workDays: allWeek,
      },
      active: true,
      sort: 1,
    },
    {
      key: 'tashkent-city-bts',
      name: { uz: 'Toshkent shahri (BTS)', ru: 'Ташкент (BTS)' },
      carrier: 'BTS',
      regions: ['tashkent_city'],
      priceSoum: 45_000,
      freeFromSoum: 500_000,
      etaLabel: { uz: '24 soat ichida', ru: 'в течение 24 часов' },
      rule: { promiseHours: 24, workDays: allWeek },
      active: true,
      sort: 2,
    },
    {
      key: 'regions-bts',
      name: { uz: "Viloyatlar va Qoraqalpog'iston", ru: 'Регионы и Каракалпакстан' },
      carrier: 'BTS',
      regions: regionsExceptTashkentCity,
      priceSoum: 45_000,
      freeFromSoum: 700_000,
      etaLabel: { uz: '24 soat ichida', ru: 'в течение 24 часов' },
      rule: { promiseHours: 24, workDays: allWeek },
      active: true,
      sort: 3,
    },
  ],
  'delivery.rules': {
    codMaxSoum: 3_000_000,
    codAutoCancelHours: 24,
    onlineReservationMinutes: 30,
    paymentReminderMinutes: 15,
  },
  'promo.rules': { maxDiscountPct: 15 },
  'catalog.rules': { lowStockDefault: 10 },
  'messaging.rules': {
    marketingPerDay: 1,
    quietStart: '21:00',
    quietEnd: '09:00',
    operatorDays: [1, 2, 3, 4, 5, 6],
    operatorStart: '09:00',
    operatorEnd: '21:00',
    abandonedCartMinutes: 120,
    reviewRequestDays: 3,
  },
  'seo.verification': { google: null, yandex: null, bing: null },
  'tracking.rules': { replaySamplePct: 30, replayCheckoutPct: 100 },
  'returns.rules': { returnDays: 14, defectReportHours: 48, refundBusinessDays: '3–10' },
  // Stock photos (design/assets/photos) until the owner uploads real ones; no how-to video yet.
  'home.media': {
    hero: {
      beforeKey: 'seed/photos/hero-before.jpg',
      afterKey: 'seed/photos/hero-after.jpg',
      alt: { uz: 'Divan yangilashdan oldin va keyin', ru: 'Диван до и после обновления' },
      productSlug: 'divan-yangilash-toplami',
    },
    howTo: null,
    leadImage: {
      key: 'seed/photos/woman-green-sofa.jpg',
      alt: { uz: 'Yangilangan yashil divan', ru: 'Обновлённый зелёный диван' },
    },
  },
  flags: { marketplace: false, cod: true, bnpl: false },
};
