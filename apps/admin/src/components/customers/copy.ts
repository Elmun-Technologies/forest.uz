import {
  type CustomerSegment,
  type CustomerSort,
  type CustomerTimelineItemDto,
  formatAmount,
  soumToTiyin,
  UZ_REGIONS,
} from '@forest/contracts/core';

/** A4/A5 copy (Uzbek; admin has no RU). */

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  all: 'Hammasi',
  new: 'Yangi',
  loyal: 'Doimiy',
  abandoned: 'Savatni tashlagan',
  inactive: 'Faol emas',
  leads: 'Faqat lead',
};

export const SEGMENT_HINT: Record<CustomerSegment, string> = {
  all: 'xaridor + lead',
  new: 'oxirgi 30 kun',
  loyal: '2+ xarid yoki LTV 2 mln+',
  abandoned: '7 kun ichida',
  inactive: '60+ kun',
  leads: "raqam bor, xarid yo'q",
};

/** Row badge (single segment). */
export const SEGMENT_BADGE: Record<
  Exclude<CustomerSegment, 'all'>,
  { label: string; tone: 'dark' | 'info' | 'good' | 'warn' | 'lead' | 'neutral' }
> = {
  loyal: { label: 'Doimiy', tone: 'good' },
  new: { label: 'Yangi', tone: 'info' },
  abandoned: { label: 'Savat tashlagan', tone: 'warn' },
  leads: { label: 'Lead', tone: 'lead' },
  inactive: { label: 'Faol emas', tone: 'neutral' },
};

export const SORT_LABEL: Record<CustomerSort, string> = {
  activity: "Oxirgi faollik bo'yicha",
  ltv: "LTV bo'yicha",
  orders: "Xaridlar soni bo'yicha",
  created: "Ro'yxatdan o'tgan sana bo'yicha",
};

const REGION = new Map<string, string>(UZ_REGIONS.map((r) => [r.code, r.uz]));
export const regionLabel = (code: string | null) => (code ? (REGION.get(code) ?? code) : '—');

/** First-source values as stored (utm source / lead form) → readable. */
const SOURCE_LABEL: Record<string, string> = {
  popup: 'Sayt · popup',
  selector: 'Sayt · tanlovchi',
  checkout: 'Sayt · checkout',
  footer: 'Sayt · footer',
  bot: 'Telegram bot',
  instagram: 'Instagram',
  facebook: 'Facebook',
  telegram: 'Telegram',
  google: 'Google',
  tiktok: 'TikTok',
  yandex: 'Yandex',
};
export const sourceLabel = (s: string | null) => (s ? (SOURCE_LABEL[s] ?? s) : '—');

export const CONSENT_CHANNEL_LABEL: Record<string, string> = {
  SMS_MARKETING: 'SMS xabarlar',
  TELEGRAM: 'Telegram bot',
  ADS_MATCHING: 'Reklama auditoriyasi',
  ANALYTICS_COOKIES: 'Cookie va analitika',
};

export const CONSENT_SOURCE_LABEL: Record<string, string> = {
  checkout: 'checkout',
  popup: 'popup',
  bot: 'bot',
  cabinet: 'kabinet',
  erasure: "o'chirish",
};

const MESSAGE_STATUS: Record<string, string> = {
  QUEUED: 'navbatda',
  SENT: 'yuborildi',
  DELIVERED: 'yetkazildi',
  FAILED: 'xato',
  SKIPPED_CAP: "o'tkazildi (limit)",
  SKIPPED_NO_CONSENT: "o'tkazildi (rozilik yo'q)",
};

const ORDER_EVENT: Record<string, string> = {
  STATUS_CHANGED: "Holat o'zgardi",
  PAYMENT_PAID: "To'lov qabul qilindi",
  PAYMENT_FAILED: "To'lov o'tmadi",
  PAYMENT_REMINDER: "To'lov eslatmasi",
  NOTE: 'Ichki izoh',
};

const REVIEW_STATUS: Record<string, string> = {
  PENDING: 'moderatsiyada',
  APPROVED: "e'lon qilingan",
  REJECTED: 'rad etilgan',
};

const PAY: Record<string, string> = { PAYME: 'Payme', CLICK: 'Click', COD: 'Naqd' };

export const SOUM = (n: number) => formatAmount(soumToTiyin(n));

/** Timeline row: title, detail line, chip. */
export function timelineText(e: CustomerTimelineItemDto): {
  title: string;
  detail: string | null;
  chip: { label: string; tone: 'dark' | 'info' | 'good' | 'warn' | 'lead' | 'neutral' };
} {
  switch (e.kind) {
    case 'created':
      return {
        title: "Mijoz sifatida qo'shildi",
        detail: null,
        chip: { label: 'Mijoz', tone: 'neutral' },
      };
    case 'lead':
      return {
        title: 'Raqam qoldirdi',
        detail: e.source ? `Manba: ${sourceLabel(e.source)}` : null,
        chip: { label: 'Lead', tone: 'lead' },
      };
    case 'order_created':
      return {
        title: `Buyurtma ${e.orderNumber} · ${SOUM(e.totalSoum)} so'm`,
        detail: PAY[e.paymentMethod] ?? e.paymentMethod,
        chip: { label: 'Xarid', tone: 'good' },
      };
    case 'order_event':
      return {
        title: `${e.orderNumber}: ${ORDER_EVENT[e.type] ?? e.type}`,
        detail: e.from || e.to ? `${e.from ?? '—'} → ${e.to ?? '—'}` : null,
        chip: { label: 'Buyurtma', tone: 'neutral' },
      };
    case 'message':
      return {
        title: `${e.channel === 'SMS' ? 'SMS' : 'Telegram'} xabar${e.templateKey ? ` · ${e.templateKey}` : ''}`,
        detail: `${MESSAGE_STATUS[e.status] ?? e.status}${e.marketing ? ' · marketing' : ''}`,
        chip: { label: 'Xabar', tone: 'warn' },
      };
    case 'consent':
      return {
        title: `${CONSENT_CHANNEL_LABEL[e.channel] ?? e.channel}: ${e.granted ? 'rozi' : 'rad etdi'}`,
        detail: `Manba: ${CONSENT_SOURCE_LABEL[e.source] ?? e.source}`,
        chip: { label: 'Rozilik', tone: 'info' },
      };
    case 'review':
      return {
        title: `${e.rating}★ sharh qoldirdi`,
        detail: REVIEW_STATUS[e.status] ?? e.status,
        chip: { label: 'Sharh', tone: 'good' },
      };
    case 'note':
      return {
        title: "Ichki izoh qo'shildi",
        detail: e.staffName,
        chip: { label: 'Izoh', tone: 'neutral' },
      };
  }
}

export const ORDER_STATUS: Record<
  string,
  { label: string; tone: 'good' | 'warn' | 'critical' | 'neutral' | 'info' }
> = {
  NEW: { label: 'Yangi', tone: 'warn' },
  CONFIRMED: { label: 'Tasdiqlangan', tone: 'info' },
  PACKING: { label: "Yig'ilmoqda", tone: 'info' },
  READY: { label: 'Tayyor', tone: 'info' },
  HANDED_TO_COURIER: { label: "Yo'lda", tone: 'info' },
  DELIVERED: { label: 'Yetkazildi', tone: 'good' },
  COMPLETED: { label: 'Yakunlangan', tone: 'good' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'critical' },
  RETURN_REQUESTED: { label: "Qaytarish so'ralgan", tone: 'warn' },
  RETURNED: { label: 'Qaytarilgan', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'kutilmoqda',
  COD_PENDING: 'olganda',
  PAID: "to'langan",
  FAILED: "o'tmadi",
  EXPIRED: 'muddati tugadi',
  REFUNDED: 'qaytarilgan',
  PARTIALLY_REFUNDED: 'qisman qaytarilgan',
};

export const PAYMENT_METHOD = PAY;
