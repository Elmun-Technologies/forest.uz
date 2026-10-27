import type { ReviewStatus } from '@forest/contracts/core';

/** A15 Sharhlar va fotolar copy (Uzbek admin). */
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: 'Kutmoqda',
  APPROVED: 'Tasdiqlangan',
  REJECTED: 'Rad etilgan',
};

export const SOURCE_LABEL: Record<string, string> = { web: 'Sayt', bot: 'Telegram bot' };

export const COPY = {
  title: 'Sharhlar va natija fotolari',
  subtitle:
    'Faqat haqiqiy xarid qilganlar sharh yoza oladi · foto faqat rozilik bilan saytga chiqadi',
  kpiAvg: "O'rtacha baho",
  kpiApproved: 'Tasdiqlangan sharh',
  kpiPhoto: 'Foto bilan',
  kpiLow: '≤3★ ochiq shikoyat',
  none: '—',
  empty: "Bu holatda sharh yo'q.",
  emptyPending:
    "Yangi sharhlar shu yerda paydo bo'ladi: ular faqat yetkazilgan buyurtmadan keyin yoziladi.",
  approve: 'Tasdiqlash',
  reject: 'Rad etish',
  rejectConfirm: "Sharh rad etilsinmi? U saytda ko'rinmaydi va galereyadan olinadi.",
  toGallery: '+ Galereyaga',
  inGallery: '✓ Galereyada',
  noConsent: "Foto/rozilik yo'q",
  galleryNeedsApproval: 'Avval tasdiqlang',
  reply: 'Ochiq javob yozish',
  editReply: 'Javobni tahrirlash',
  replyLabel: "Do'kon javobi (saytda ko'rinadi)",
  saveReply: 'Javobni saqlash',
  verified: 'Xarid tasdiqlangan',
  consentYes: 'Foto: saytga rozilik ✓',
  consentNo: "Foto: rozilik yo'q",
  galleryTitle: 'Saytdagi «Natijalar» galereyasi',
  galleryHint: "Tartibni sudrab o'zgartiring · bosh sahifa va mahsulot sahifasida",
  galleryEmpty:
    "Galereya bo'sh. Tasdiqlangan, rozilik berilgan fotoli sharhni «+ Galereyaga» bilan qo'shing.",
  pair: 'oldin/keyin juftligi',
  before: 'Oldin',
  after: 'Keyin',
  uploadBefore: '+ «Oldin» rasmi',
  removeFromGallery: 'Galereyadan olish',
  more: 'Yana yuklash',
  lowOnly: '≤3★',
  photosOnly: 'Foto bilan',
  allSources: 'Barcha manbalar',
  readOnly: "Faqat ko'rish: moderatsiya huquqi yo'q.",
} as const;
