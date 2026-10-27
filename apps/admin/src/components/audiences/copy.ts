import type {
  AdSignalPlatform,
  AudienceConditionType,
  AudienceConsent,
  AudienceDestination,
  AudienceDevice,
  AudienceEvent,
  AudienceLeadSource,
  SegmentSyncStatus,
} from '@forest/contracts/core';

/** A8 Auditoriyalar copy (Uzbek admin, design Admin-Auditoriya). */
export const COPY = {
  title: 'Auditoriyalar va retarget',
  subtitle:
    'Segmentlar har soatda yangilanadi va ulangan reklama platformalariga avtomatik yuboriladi',
  add: '+ Yangi auditoriya',
  empty: "Hali segment yo'q. «Yangi auditoriya» bilan boshlang.",
  rules: 'Qoidalar',
  if: 'AGAR',
  and: 'VA',
  or: 'YOKI',
  addRule: "+ Qoida qo'shish",
  addGroup: '+ YOKI guruh',
  removeRule: "Qoidani o'chirish",
  size: 'Hozirgi hajm',
  withPhone: 'Telefon raqami bor',
  withTelegram: 'Telegram ulangan',
  adsReady: 'Reklamaga yuboriladi',
  sizeHint: "Saqlanmagan qoidalar bo'yicha jonli hisob (yangilanishda xuddi shu so'rov ishlaydi).",
  destinations: 'Qayerga yuboriladi',
  hashNote:
    'Telefon raqamlari platformaga SHA-256 bilan xeshlanib yuboriladi. Faqat reklamaga rozilik bergan mijozlar kiradi.',
  autoMessage: 'Avtomatik xabar',
  autoPhase:
    'Sozlama saqlanadi; yuborish 5-bosqichda (Telegram bot va avtomatlashtirish) ishga tushadi.',
  result: 'Natija (30 kun)',
  noResult: "Hali natija yo'q",
  save: 'Saqlash',
  create: 'Yaratish',
  saved: 'Saqlandi. Segment fonda yangilanmoqda.',
  refresh: 'Hozir yangilash',
  refreshed: "Yangilash navbatga qo'yildi.",
  active: 'Faol · avtomatik yangilanadi',
  paused: "To'xtatilgan",
  name: 'Nomi',
  description: 'Tavsif',
  members: "A'zolar",
  noMembers: "Hozircha a'zo yo'q.",
  refreshedNever: 'hali yangilanmagan',
  signals: 'Server signallari (24 soat)',
  signalsHint:
    "lead, add_to_cart, begin_checkout, purchase — reklamaga rozilik bergan mijozlarniki, hodisa ID'si bilan (piksel bilan takrorlanmaydi).",
  notConnected: 'ulanmagan',
  fake: 'fake rejim',
} as const;

export const CONDITION_LABEL: Record<AudienceConditionType, string> = {
  event: 'Hodisa',
  page_time: 'Sahifada vaqt',
  orders: 'Xaridlar',
  last_order: 'Oxirgi xarid',
  product: 'Mahsulot',
  consent: 'Rozilik',
  tag: 'Teg',
  region: 'Hudud',
  device: 'Qurilma',
  lead: 'Lead',
};

export const EVENT_LABEL: Record<AudienceEvent, string> = {
  page_view: 'page_view',
  view_item_list: 'view_item_list',
  view_item: 'view_item',
  select_variant: 'select_variant',
  calculator_used: 'calculator_used',
  selector_used: 'selector_used',
  selector_result: 'selector_result',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'remove_from_cart',
  view_cart: 'view_cart',
  promo_applied: 'promo_applied',
  begin_checkout: 'begin_checkout',
  add_shipping_info: 'add_shipping_info',
  add_payment_info: 'add_payment_info',
  search: 'search',
  waitlist_join: 'waitlist_join',
  telegram_click: 'telegram_click',
  video_play: 'video_play',
  lead: 'lead',
  purchase: 'purchase',
};

export const CONSENT_LABEL: Record<AudienceConsent, string> = {
  sms: 'SMS reklama',
  telegram: 'Telegram',
  ads: 'Reklamaga rozilik',
};

export const DEVICE_LABEL: Record<AudienceDevice, string> = {
  mobile: 'Mobil',
  desktop: 'Kompyuter',
  tablet: 'Planshet',
};

export const LEAD_SOURCE_LABEL: Record<AudienceLeadSource, string> = {
  popup: 'Popup',
  selector: 'Tanlovchi',
  footer: 'Footer',
  home: 'Bosh sahifa',
  bot: 'Telegram bot',
  checkout: 'Checkout',
  telegram_login: 'Telegram orqali kirish',
};

export const DESTINATION_LABEL: Record<AudienceDestination, { name: string; hint: string }> = {
  meta: { name: 'Meta Custom Audience', hint: 'Facebook va Instagram reklamasi' },
  google: { name: 'Google Ads Customer Match', hint: 'Qidiruv, YouTube, PMax' },
  tiktok: { name: 'TikTok Custom Audience', hint: 'TikTok Ads · kamida 1 000 kishi' },
  yandex: { name: 'Yandex Audience', hint: 'Yandex Direct · kamida 100 kishi' },
  telegram: { name: 'Telegram bot', hint: 'Shaxsiy xabar, rozilik bilan · 5-bosqich' },
  sms: { name: 'SMS (Eskiz / Playmobile)', hint: 'Faqat rozilik berganlarga · 5-bosqich' },
};

export const SYNC_LABEL: Record<SegmentSyncStatus, string> = {
  pending: 'navbatda',
  ok: 'yuborildi',
  error: 'xato',
  not_connected: 'integratsiya ulanmagan',
  too_small: 'auditoriya juda kichik',
  off: "o'chiq",
};

export const SYNC_TONE: Record<SegmentSyncStatus, 'good' | 'warn' | 'critical' | 'neutral'> = {
  pending: 'neutral',
  ok: 'good',
  error: 'critical',
  not_connected: 'warn',
  too_small: 'warn',
  off: 'neutral',
};

export const PLATFORM_LABEL: Record<AdSignalPlatform, string> = {
  meta: 'Meta CAPI',
  google: 'Google Ads',
  tiktok: 'TikTok Events API',
};
