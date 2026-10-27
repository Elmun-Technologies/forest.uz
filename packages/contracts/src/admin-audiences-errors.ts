/**
 * Admin audiences (A8) error codes, spread into `ADMIN_ERROR_MESSAGES`. Uzbek is the admin
 * language; `ru` keeps the shape uniform.
 */
export const ADMIN_AUDIENCES_ERROR_MESSAGES = {
  AUDIENCE_PRODUCT_NOT_FOUND: {
    http: 400,
    uz: "Qoidadagi mahsulot topilmadi. Mahsulotni ro'yxatdan qayta tanlang.",
    ru: 'Товар из правила не найден. Выберите товар из списка заново.',
  },
  AUDIENCE_TEMPLATE_NOT_MARKETING: {
    http: 400,
    uz: "Avtomatik xabar uchun faqat marketing shablonlari (savat eslatmasi, sharh so'rovi yoki o'zingiz yaratgan) va ular qo'llaydigan kanal tanlanadi.",
    ru: 'Для автосообщения подходят только маркетинговые шаблоны (напоминание о корзине, просьба об отзыве или свои) и поддерживаемый ими канал.',
  },
  AUDIENCE_TEMPLATE_NOT_FOUND: {
    http: 400,
    uz: 'Avtomatik xabar shabloni topilmadi.',
    ru: 'Шаблон автоматического сообщения не найден.',
  },
} as const;
