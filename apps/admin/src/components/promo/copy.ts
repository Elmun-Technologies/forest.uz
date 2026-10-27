import type { PromoAudience, PromoState, PromoType } from '@forest/contracts/core';

/** A14 Promo-kodlar copy (Uzbek admin). */
export const PROMO_TYPE_LABEL: Record<PromoType, string> = {
  PERCENT: 'Foiz %',
  FIXED: "Summa so'm",
  FREE_SHIPPING: 'Bepul yetkazish',
  GIFT: "Sovg'a mahsulot",
};

export const AUDIENCE_LABEL: Record<PromoAudience, string> = {
  ALL: 'Hamma',
  FIRST_ORDER: 'Yangi mijozlar (birinchi buyurtma)',
  SEGMENT: 'Auditoriya segmenti',
};

export const AUDIENCE_SHORT: Record<PromoAudience, string> = {
  ALL: 'Hamma uchun',
  FIRST_ORDER: 'Birinchi buyurtma',
  SEGMENT: 'Segment',
};

export const STATE_LABEL: Record<PromoState, string> = {
  active: 'Faol',
  scheduled: 'Rejalashtirilgan',
  expired: 'Muddati tugagan',
  paused: "To'xtatilgan",
  exhausted: 'Limit tugagan',
};

export const STATE_TONE: Record<PromoState, 'good' | 'warn' | 'neutral' | 'critical'> = {
  active: 'good',
  scheduled: 'warn',
  expired: 'neutral',
  paused: 'neutral',
  exhausted: 'critical',
};

export const COPY = {
  title: 'Promo-kodlar va aksiyalar',
  subtitle: "Har kod manba bilan: qaysi kanal qancha foyda keltirgani ko'rinadi",
  add: '+ Yangi kod',
  kpiOrders: 'Kod bilan buyurtma',
  kpiDiscount: 'Berilgan chegirma',
  kpiRevenue: 'Kod keltirgan daromad',
  kpiSuspicious: 'Shubhali ishlatish',
  empty: "Promo-kod yo'q. «+ Yangi kod» bilan yarating.",
  rules: 'Himoya qoidalari',
  ruleStack: "Boshqa kod va to'plam chegirmasi bilan qo'shilmaydi",
  ruleGuard: 'Marja himoyasi: jami chegirma ≤ {max}%',
  ruleDevice: 'Yangi mijoz kodi: bir telefon / bir qurilma — bir marta',
  automatic: 'Avtomatik aksiyalar',
  automaticHint: "kodsiz, savatda o'zi qo'llanadi",
  freeShipping: 'Bepul yetkazish',
  kits: "To'plam narxi",
  kitsNote: "kodlar bilan qo'shilmaydi",
  secondGift: "2-xarid sovg'asi",
  off: "o'chiq",
  noKits: "Faol to'plam yo'q",
  save: 'Saqlash',
  saved: 'Saqlandi',
  pause: "To'xtatish",
  resume: 'Faollashtirish',
  pauseConfirm: "Kod to'xtatilsinmi? Mijozlar uni savatda qo'llay olmaydi.",
  lockedHint: 'Kod ishlatilgan — matnini o‘zgartirib bo‘lmaydi',
  pickCode: 'Tahrirlash uchun koddan birini tanlang yoki yangisini yarating.',
  unlimited: 'Muddatsiz',
} as const;
