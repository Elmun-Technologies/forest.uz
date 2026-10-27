import type {
  PasswordProblem,
  Permission,
  RbacMatrixRowKey,
  StaffRole,
} from '@forest/contracts/core';

/**
 * Admin UI copy (Uzbek only — the admin panel has no RU, docs/08). One place, so texts are
 * reviewed together and never hardcoded in components.
 */
export const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Egasi',
  MANAGER: 'Menejer',
  OPERATOR: 'Operator',
  WAREHOUSE: 'Omborchi',
  MARKETER: 'Marketolog',
};

/** Under the name in the sidebar (design: "Egasi · barcha huquqlar"). */
export const ROLE_HINT: Record<StaffRole, string> = {
  OWNER: 'Egasi · barcha huquqlar',
  MANAGER: 'Menejer',
  OPERATOR: 'Operator',
  WAREHOUSE: 'Omborchi',
  MARKETER: 'Marketolog',
};

/** A16 "Rollar va huquqlar" — the docs/02 rows (design copy). */
export const MATRIX_ROW_LABEL: Record<RbacMatrixRowKey, string> = {
  orders: "Buyurtmalarni ko'rish va o'zgartirish",
  cancelRefund: 'Buyurtmani bekor qilish / pul qaytarish',
  customerPii: 'Mijoz telefoni va manzili',
  customerExport: 'Mijozlar bazasini eksport',
  productContent: 'Mahsulot tavsifi, rasm, SEO',
  promo: 'Promo-kodlar',
  analytics: 'Analitika va heatmap',
  integrationKeys: 'Integratsiya kalitlari',
};

/** Extra matrix rows: permissions the docs don't list (least-privilege choices, CLAUDE.md §6). */
export const EXTRA_MATRIX_ROWS: { permission: Permission; label: string }[] = [
  { permission: 'customers.view', label: "Mijozlar ro'yxati (yashirilgan raqamlar)" },
  { permission: 'reviews.moderate', label: 'Sharhlarni tasdiqlash / rad etish' },
  { permission: 'bot.inbox', label: 'Telegram: operator chatlari' },
  { permission: 'bot.edit', label: 'Telegram: ssenariy va shablonlar' },
  { permission: 'moysklad.sync', label: 'MoySklad: holat va sinxronlash' },
  { permission: 'settings.delivery', label: 'Yetkazish sozlamalari' },
  { permission: 'settings.store', label: "Do'kon va yuridik ma'lumotlar" },
  { permission: 'settings.staff', label: 'Xodimlar va rollar' },
  { permission: 'audit.view', label: 'Faoliyat jurnali' },
];

export const MATRIX_NOTE =
  "Operator mijoz telefonini to'liq ko'radi, lekin bazani eksport qila olmaydi. Integratsiya kalitlarini faqat Egasi o'zgartiradi. Omborchi manzilni faqat qadoqlash varaqasida ko'radi.";

export const PASSWORD_PROBLEM: Record<PasswordProblem, string> = {
  too_short: 'Kamida 12 ta belgi',
  too_long: "Ko'pi bilan 128 ta belgi",
  contains_name: "Ismingiz yoki email nomingiz bo'lmasin",
  too_common: "Oddiy so'z yoki takror belgilar bo'lmasin",
};

/** Audit actions → readable text; unknown actions are shown as stored. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Tizimga kirdi',
  'auth.password_verified': "Parol to'g'ri — 2FA kutilmoqda",
  'auth.logout': 'Tizimdan chiqdi',
  'auth.totp_reverified': '2FA kodini qayta tasdiqladi',
  'staff.invite': 'Xodimni taklif qildi',
  'staff.invite_reissued': 'Taklif havolasini yangiladi',
  'staff.invite_accepted': 'Taklifni qabul qildi',
  'staff.update': "Xodim ma'lumotlarini o'zgartirdi",
  'staff.totp_setup_started': '2FA sozlashni boshladi',
  'staff.totp_enabled': '2FA ni yoqdi',
  'staff.totp_reset': '2FA ni bekor qildi (qayta sozlash kerak)',
  'staff.login_locked': "Kirish bloklandi (ko'p xato urinish)",
  'integration.update': "Integratsiya sozlamalarini o'zgartirdi",
  'integration.disconnect': 'Integratsiyani uzdi',
  'integration.secret_rotated': 'Integratsiya kaliti yangilandi (provayder)',
  'customer.view_pii': "Mijozning shaxsiy ma'lumotlarini ko'rdi",
  'customer.data_export': "Mijoz ma'lumotlarini yuklab oldi",
  'customer.erase_requested': "Mijoz ma'lumotlarini o'chirishni so'radi",
  'customer.telegram_merged': 'Telegram akkaunt birlashtirildi',
  'order.fiscal_receipt_recorded': 'Fiskal chekni kiritdi',
  'order.fiscal_receipt_corrected': "Fiskal chekni to'g'riladi",
  'customer.tags_update': "Mijoz teglarini o'zgartirdi",
  'customer.note_added': "Mijozga izoh qo'shdi",
  'customer.export': 'Mijozlar bazasini eksport qildi (CSV)',
  'customer.erase': "Mijoz ma'lumotlarini o'chirdi (anonimlashtirildi)",
  'settings.store.update': "Do'kon sozlamalarini o'zgartirdi",
  'settings.delivery.update': "Yetkazish sozlamalarini o'zgartirdi",
  'integration.test': 'Integratsiyani tekshirdi',
  'integration.view_secret': "Maxfiy callback manzilini ko'rdi",
  'product.create': 'Mahsulot yaratdi',
  'product.update': "Mahsulotni o'zgartirdi",
  'product.delete': "Mahsulot qoralamasini o'chirdi",
  'product.relations_update': "Bog'liq mahsulotlarni o'zgartirdi",
  'product.image_add': "Mahsulot rasmini qo'shdi",
  'product.image_update': "Rasm alt matnini o'zgartirdi",
  'product.image_reorder': 'Rasmlar tartibini o‘zgartirdi',
  'product.image_delete': "Mahsulot rasmini o'chirdi",
  'variant.create': "Variant qo'shdi",
  'variant.update': "Variantni o'zgartirdi",
  'variant.delete': "Variantni o'chirdi",
  'variant.reorder': 'Variantlar tartibini o‘zgartirdi',
  'review.moderate': 'Sharhni moderatsiya qildi',
  'review.reply': 'Sharhga ochiq javob yozdi',
  'review.gallery': "Galereyani o'zgartirdi",
  'review.gallery_reorder': 'Galereya tartibini o‘zgartirdi',
  'review.before_upload': '«Oldin» rasmini yukladi',
  'promo.create': 'Promo-kod yaratdi',
  'promo.update': "Promo-kodni o'zgartirdi",
};

/** Audit entity names (filter options keep the stored name as value). */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  Staff: 'Xodim',
  Integration: 'Integratsiya',
  Customer: 'Mijoz',
  Order: 'Buyurtma',
  Setting: 'Sozlama',
  Product: 'Mahsulot',
  Variant: 'Variant',
  Review: 'Sharh',
  PromoCode: 'Promo-kod',
};

export const SYSTEM_ACTOR = 'Tizim';

/** Panel error boundary (`app/(panel)/error.tsx`): an API failure while rendering a page. */
export const PAGE_ERROR = {
  title: "Sahifani ochib bo'lmadi",
  text: "Server so'rovga javob bermadi yoki manzildagi filtr eskirgan. Qayta urinib ko'ring yoki bo'lim boshiga qayting.",
  retry: 'Qayta urinish',
  back: 'Dashboardga qaytish',
  code: 'Xato kodi',
} as const;
