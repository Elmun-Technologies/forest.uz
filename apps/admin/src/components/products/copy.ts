import type { ProductBadge, ProductStatus, RelationKind } from '@forest/contracts/core';

/** A11 Mahsulotlar copy (Uzbek admin, CLAUDE.md §6: copy kept out of components). */
export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: 'Qoralama',
  ACTIVE: 'Faol',
  ARCHIVED: 'Arxiv',
};

export const PRODUCT_STATUS_TONE: Record<ProductStatus, 'neutral' | 'good' | 'warn'> = {
  DRAFT: 'warn',
  ACTIVE: 'good',
  ARCHIVED: 'neutral',
};

export const BADGE_LABEL: Record<ProductBadge, string> = {
  HIT: 'Xit',
  NEW: 'Yangi',
  SALE: 'Chegirma',
};

export const SURFACE_LABEL: Record<string, string> = {
  wood: "Yog'och",
  lacquer: 'Lak',
  metal: 'Metall',
  fabric: 'Mato',
};

export const RELATION_LABEL: Record<RelationKind, string> = {
  CROSS_SELL: 'Birga olinadi',
  UPSELL: 'Yaxshiroq variant (upsell)',
  ALTERNATIVE: 'Muqobil (tugaganda)',
};

export const PRODUCT_TABS = [
  { id: 'main', label: 'Asosiy' },
  { id: 'variants', label: 'Variantlar' },
  { id: 'images', label: 'Rasmlar' },
  { id: 'seo', label: 'SEO' },
] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number]['id'];

export const COPY = {
  title: 'Mahsulotlar',
  subtitleMoysklad: "Narx va qoldiq MoySklad'dan keladi · tavsif, rasm va SEO shu yerda",
  subtitleLocal: 'MoySklad ulanmagan: narx va qoldiq shu yerda · tavsif, rasm va SEO ham',
  add: '+ Mahsulot',
  kpiActive: 'Faol mahsulotlar',
  kpiLow: 'Kam qoldiq',
  kpiFeeds: "Katalog feed'lari",
  kpiFeedsHint: '4-bosqichda ulanadi',
  kpiIkpu: "IKPU (MXIK) kodi yo'q",
  kpiIkpuHint: "Faollashtirishdan oldin to'ldiring",
  search: 'Nom yoki SKU',
  all: 'Hammasi',
  empty: "Bu filtr bo'yicha mahsulot yo'q.",
  emptyCta: "Filtrlarni tozalang yoki yangi mahsulot qo'shing.",
  more: 'Keyingi sahifa',
  first: 'Boshiga',
  pickProduct: "Tahrirlash uchun ro'yxatdan mahsulot tanlang.",
  seller: 'Sotuvchi',
  official: 'rasmiy',
  viewOnSite: "Saytda ko'rish",
  viewOnSiteDisabled: "Faqat faol mahsulot saytda ko'rinadi",
  save: 'Saqlash',
  saved: 'Saqlandi',
  aiDraft: 'AI tavsif',
  aiDraftHint: 'AI integratsiyasi keyingi bosqichda ulanadi',
  readOnly: "Faqat ko'rish: o'zgartirish huquqi yo'q.",
  priceLocked:
    "Narx MoySklad'da o'zgartiriladi. IKPU (MXIK) kodi fiskal chek uchun to'lov tizimiga yuboriladi.",
  stockLocked: "Qoldiq MoySklad'dan keladi.",
  listLocked: "Variantlar ro'yxati MoySklad'dan keladi (yangi variant MoySklad'da qo'shiladi).",
  ikpuNote: "IKPU (MXIK) — 17 raqam. Faol mahsulotning har bir faol variantida bo'lishi shart.",
  channels: "Saytda ko'rsatiladigan kanallar",
  channelSite: 'Sayt',
  channelsLater: "Meta katalog, Google Merchant, Telegram bot — feed'lar 4-bosqichda",
  deleteDraft: "Qoralamani o'chirish",
  deleteConfirm: "Mahsulot butunlay o'chiriladi. Davom etasizmi?",
  archiveHint: "Sotilgan mahsulotni o'chirib bo'lmaydi — holatini «Arxiv» qiling.",
  slugWarn: "Manzil o'zgarsa eski havolalar avtomatik 301 bilan yangisiga yo'naltiriladi.",
  seoCenter: 'SEO markazida tahrirlash',
  seoCenterLater: 'SEO markazi tez orada',
  seoStorefrontNote:
    'Sahifa sarlavhasi hozircha andozadan olinadi; bu yerda saqlangan qiymatlar SEO markazi bilan saytga ulanadi.',
  seoTemplateHint: "Bo'sh qoldirilsa andoza ishlatiladi",
} as const;
