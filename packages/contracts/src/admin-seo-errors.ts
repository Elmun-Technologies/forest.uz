/** SEO center (A9) error codes, spread into `ADMIN_ERROR_MESSAGES`. */
export const ADMIN_SEO_ERROR_MESSAGES = {
  REDIRECT_LOOP: {
    http: 409,
    uz: "Bu yo'naltirish aylanma hosil qiladi (manzil o'ziga qaytadi). Boshqa manzil tanlang.",
    ru: 'Этот редирект образует цикл (адрес ведёт сам на себя). Выберите другой адрес.',
  },
  REDIRECT_SOURCE_LIVE: {
    http: 409,
    uz: "Bu manzilda ishlayotgan sahifa bor — undan yo'naltirib bo'lmaydi.",
    ru: 'По этому адресу работает страница — с него нельзя перенаправить.',
  },
  REDIRECT_INVALID_PATH: {
    http: 400,
    uz: "Manzil sayt ichidagi yo'l bo'lishi kerak, masalan /uz/p/chalk-white.",
    ru: 'Адрес должен быть путём на сайте, например /uz/p/chalk-white.',
  },
  SEO_PAGE_UNKNOWN: {
    http: 404,
    uz: "Bunday sahifa saytda yo'q. Ro'yxatdan tanlang.",
    ru: 'Такой страницы на сайте нет. Выберите из списка.',
  },
  SEO_CANONICAL_INVALID: {
    http: 400,
    uz: "Canonical — sayt ichidagi yo'l (/uz/…) yoki https manzil bo'lishi kerak.",
    ru: 'Canonical — путь на сайте (/uz/…) или https-адрес.',
  },
  SEO_OG_IMAGE_INVALID: {
    http: 400,
    uz: 'OG rasm topilmadi yoki ochiq emas. Mahsulot rasmlaridan birini tanlang.',
    ru: 'OG-изображение не найдено или не публичное. Выберите одно из фото товара.',
  },
  SEO_VERIFICATION_INVALID: {
    http: 400,
    uz: "Tasdiqlash kodi noto'g'ri. Kodni yoki butun <meta> tegini nusxalab qo'ying.",
    ru: 'Неверный код подтверждения. Вставьте код или весь тег <meta>.',
  },
  SEO_SOURCE_NOT_CONNECTED: {
    http: 409,
    uz: 'Avval Integratsiyalar sahifasida ulang.',
    ru: 'Сначала подключите на странице интеграций.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
