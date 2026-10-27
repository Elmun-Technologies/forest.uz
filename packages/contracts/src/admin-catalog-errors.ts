/**
 * Admin catalog error codes (A11 products, A14 promo, A15 reviews), spread into
 * `ADMIN_ERROR_MESSAGES`. Uzbek is the admin language; `ru` keeps the shape uniform.
 */
export const ADMIN_CATALOG_ERROR_MESSAGES = {
  PRODUCT_IKPU_REQUIRED: {
    http: 409,
    uz: "Faollashtirish uchun har bir faol variantda IKPU (MXIK) kodi bo'lishi kerak: {skus}.",
    ru: 'Для активации у каждого активного варианта должен быть код ИКПУ (MXIK): {skus}.',
  },
  PRODUCT_PRICE_REQUIRED: {
    http: 409,
    uz: "Faol variantning narxi kamida 1 so'm bo'lishi kerak: {skus}.",
    ru: 'У активного варианта цена должна быть не меньше 1 сума: {skus}.',
  },
  PRODUCT_SLUG_TAKEN: {
    http: 409,
    uz: 'Bu manzil (slug) boshqa mahsulotda band. Boshqasini tanlang.',
    ru: 'Этот адрес (slug) уже занят другим товаром. Выберите другой.',
  },
  PRODUCT_SKU_TAKEN: {
    http: 409,
    uz: 'Bu SKU boshqa variantda bor. SKU takrorlanmasligi kerak.',
    ru: 'Такой SKU уже есть у другого варианта. SKU должен быть уникальным.',
  },
  PRODUCT_HAS_ORDERS: {
    http: 409,
    uz: "Buyurtmalarda ishlatilgan — o'chirib bo'lmaydi. Uning o'rniga arxivlang yoki o'chirib qo'ying.",
    ru: 'Уже есть в заказах — удалить нельзя. Архивируйте или отключите вместо этого.',
  },
  PRODUCT_DELETE_NOT_DRAFT: {
    http: 409,
    uz: "Faqat qoralama mahsulotni o'chirish mumkin. Faol mahsulotni arxivlang.",
    ru: 'Удалить можно только черновик. Активный товар — архивируйте.',
  },
  PRODUCT_LAST_VARIANT: {
    http: 409,
    uz: 'Faol mahsulotda kamida bitta faol variant qolishi kerak.',
    ru: 'У активного товара должен остаться хотя бы один активный вариант.',
  },
  PRODUCT_VARIANT_IN_BUNDLE: {
    http: 409,
    uz: "Bu variant to'plam tarkibida — avval to'plamdan chiqaring.",
    ru: 'Этот вариант входит в набор — сначала уберите его из набора.',
  },
  CATALOG_MOYSKLAD_READONLY: {
    http: 409,
    uz: "MoySklad ulangan: narx, qoldiq, SKU, faollik va variantlar ro'yxati MoySklad'da o'zgartiriladi (arxivlash ham).",
    ru: 'MoySklad подключён: цены, остатки, SKU, активность и список вариантов меняются в MoySklad (архивация тоже).',
  },
  FILE_TYPE_UNSUPPORTED: {
    http: 400,
    uz: 'Faqat JPG, PNG yoki WebP rasm yuklash mumkin (10 MB gacha).',
    ru: 'Можно загрузить только JPG, PNG или WebP (до 10 МБ).',
  },
  FILE_TOO_LARGE: {
    http: 413,
    uz: 'Fayl juda katta: 10 MB gacha rasm yuklang.',
    ru: 'Файл слишком большой: загрузите изображение до 10 МБ.',
  },
  FILE_STORAGE_FAILED: {
    http: 502,
    uz: "Rasmni saqlab bo'lmadi. Bir daqiqadan keyin qayta urinib ko'ring.",
    ru: 'Не удалось сохранить изображение. Попробуйте через минуту.',
  },
  REVIEW_GALLERY_NOT_ALLOWED: {
    http: 409,
    uz: "Galereyaga faqat tasdiqlangan, fotoga rozilik berilgan va rasmli sharh qo'shiladi.",
    ru: 'В галерею попадают только одобренные отзывы с фото и согласием на публикацию.',
  },
  REVIEW_PHOTO_NOT_FOUND: {
    http: 400,
    uz: 'Bu rasm ushbu sharhga tegishli emas.',
    ru: 'Это фото не относится к этому отзыву.',
  },
  PROMO_CODE_TAKEN: {
    http: 409,
    uz: 'Bunday kod allaqachon bor.',
    ru: 'Такой код уже существует.',
  },
  PROMO_CODE_LOCKED: {
    http: 409,
    uz: "Kod ishlatilgan — nomini o'zgartirib bo'lmaydi (statistika saqlanadi). Yangi kod yarating.",
    ru: 'Код уже использовали — переименовать нельзя (сохраняется статистика). Создайте новый.',
  },
  PROMO_OVER_MARGIN_GUARD: {
    http: 400,
    uz: 'Chegirma marja himoyasidan oshadi: jami chegirma {max}% dan oshmasin (min. savatga nisbatan).',
    ru: 'Скидка превышает защиту маржи: не больше {max}% (от минимальной корзины).',
  },
  PROMO_GIFT_INVALID: {
    http: 400,
    uz: "Sovg'a uchun faol variantni tanlang.",
    ru: 'Выберите активный вариант для подарка.',
  },
  PROMO_DATES_INVALID: {
    http: 400,
    uz: "Tugash sanasi boshlanishidan keyin bo'lsin.",
    ru: 'Дата окончания должна быть позже даты начала.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
