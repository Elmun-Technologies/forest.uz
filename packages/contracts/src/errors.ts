import type { Locale } from './locale';

/**
 * Stable error codes shared by API, web and admin. Messages never blame the user and always
 * suggest the next step (design board "Holatlar").
 */
export const ERROR_MESSAGES = {
  VALIDATION_FAILED: {
    http: 400,
    uz: "Ma'lumotlarni tekshirib, qayta yuboring.",
    ru: 'Проверьте данные и отправьте ещё раз.',
  },
  PHONE_INCOMPLETE: {
    http: 400,
    uz: "Raqam to'liq emas: 9 ta raqam kerak (90 123 45 67).",
    ru: 'Номер неполный: нужно 9 цифр (90 123 45 67).',
  },
  PHONE_INVALID_OPERATOR: {
    http: 400,
    uz: "Operator kodi noto'g'ri. Raqamni tekshirib ko'ring.",
    ru: 'Неверный код оператора. Проверьте номер.',
  },
  PHONE_INVALID: {
    http: 400,
    uz: "Raqam noto'g'ri. Masalan: 90 123 45 67.",
    ru: 'Неверный номер. Например: 90 123 45 67.',
  },
  NOT_FOUND: { http: 404, uz: 'Topilmadi.', ru: 'Не найдено.' },
  PRODUCT_NOT_FOUND: { http: 404, uz: 'Mahsulot topilmadi.', ru: 'Товар не найден.' },
  OUT_OF_STOCK: {
    http: 409,
    uz: "Bu mahsulot hozir omborda yo'q. Kelganda xabar beramiz.",
    ru: 'Этого товара сейчас нет в наличии. Сообщим, когда появится.',
  },
  INSUFFICIENT_STOCK: {
    http: 409,
    uz: "Omborda yetarli miqdor yo'q. Sonini kamaytirib ko'ring.",
    ru: 'Недостаточно товара на складе. Уменьшите количество.',
  },
  CART_EMPTY: {
    http: 400,
    uz: "Savat bo'sh. Avval mahsulot tanlang.",
    ru: 'Корзина пуста. Сначала выберите товар.',
  },
  PROMO_NOT_FOUND: {
    http: 400,
    uz: "Bunday promokod topilmadi. Harflarni tekshirib ko'ring.",
    ru: 'Промокод не найден. Проверьте написание.',
  },
  PROMO_EXPIRED: {
    http: 400,
    uz: 'Promokod muddati tugagan.',
    ru: 'Срок действия промокода истёк.',
  },
  PROMO_NOT_STARTED: { http: 400, uz: 'Promokod hali faol emas.', ru: 'Промокод ещё не активен.' },
  PROMO_INACTIVE: { http: 400, uz: "Promokod to'xtatilgan.", ru: 'Промокод отключён.' },
  PROMO_MIN_CART: {
    http: 400,
    uz: 'Bu kod {min} dan katta savat uchun ishlaydi.',
    ru: 'Код действует для корзины от {min}.',
  },
  PROMO_FIRST_ORDER_ONLY: {
    http: 400,
    uz: 'Bu kod faqat birinchi buyurtma uchun.',
    ru: 'Этот код только для первого заказа.',
  },
  PROMO_ALREADY_USED: {
    http: 400,
    uz: 'Siz bu koddan allaqachon foydalangansiz.',
    ru: 'Вы уже использовали этот код.',
  },
  PROMO_LIMIT_REACHED: {
    http: 400,
    uz: 'Promokod limiti tugagan.',
    ru: 'Лимит промокода исчерпан.',
  },
  PROMO_NOT_IN_SEGMENT: {
    http: 400,
    uz: 'Bu kod sizning hisobingiz uchun emas.',
    ru: 'Этот код недоступен для вашего аккаунта.',
  },
  PROMO_NO_BENEFIT: {
    http: 400,
    uz: "To'plam chegirmasi bu koddan foydaliroq — u allaqachon qo'llangan.",
    ru: 'Скидка на набор выгоднее этого кода — она уже применена.',
  },
  ORDER_NOT_FOUND: { http: 404, uz: 'Buyurtma topilmadi.', ru: 'Заказ не найден.' },
  ORDER_INVALID_TRANSITION: {
    http: 409,
    uz: "Buyurtma holatini bunday o'zgartirib bo'lmaydi.",
    ru: 'Нельзя изменить статус заказа таким образом.',
  },
  PAYMENT_INVALID_TRANSITION: {
    http: 409,
    uz: "To'lov holatini bunday o'zgartirib bo'lmaydi.",
    ru: 'Нельзя изменить статус оплаты таким образом.',
  },
  ADDRESS_LOCKED: {
    http: 409,
    uz: "Buyurtma kuryerga topshirilgan — manzilni operator orqali o'zgartiring.",
    ru: 'Заказ передан курьеру — измените адрес через оператора.',
  },
  COD_LIMIT_EXCEEDED: {
    http: 400,
    uz: "Bu summa uchun onlayn to'lov kerak (Payme yoki Click).",
    ru: 'Для этой суммы нужна онлайн-оплата (Payme или Click).',
  },
  DELIVERY_UNAVAILABLE: {
    http: 400,
    uz: "Bu hududga yetkazish hozircha yo'q. Operator bilan bog'laning.",
    ru: 'Доставка в этот регион пока недоступна. Свяжитесь с оператором.',
  },
  OTP_RATE_LIMITED: {
    http: 429,
    uz: 'Kodni qayta yuborish uchun biroz kuting.',
    ru: 'Подождите немного, чтобы отправить код повторно.',
  },
  OTP_INVALID: {
    http: 400,
    uz: "Kod noto'g'ri. Qayta kiriting.",
    ru: 'Неверный код. Введите ещё раз.',
  },
  OTP_EXPIRED: {
    http: 400,
    uz: 'Kod muddati tugadi. Yangi kod oling.',
    ru: 'Срок действия кода истёк. Получите новый.',
  },
  OTP_TOO_MANY_ATTEMPTS: {
    http: 429,
    uz: "Urinishlar ko'p bo'ldi. Yangi kod oling.",
    ru: 'Слишком много попыток. Получите новый код.',
  },
  UNAUTHORIZED: { http: 401, uz: 'Iltimos, tizimga kiring.', ru: 'Пожалуйста, войдите в систему.' },
  FORBIDDEN: {
    http: 403,
    uz: "Bu amal uchun huquq yo'q.",
    ru: 'Недостаточно прав для этого действия.',
  },
  RATE_LIMITED: {
    http: 429,
    uz: "So'rovlar ko'p. Bir daqiqadan keyin urinib ko'ring.",
    ru: 'Слишком много запросов. Попробуйте через минуту.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    http: 400,
    uz: "So'rov kaliti yo'q.",
    ru: 'Отсутствует ключ идемпотентности.',
  },
  INTEGRATION_NOT_CONFIGURED: {
    http: 503,
    uz: 'Xizmat hali ulanmagan.',
    ru: 'Сервис ещё не подключён.',
  },
  INTERNAL: {
    http: 500,
    uz: "Nimadir xato ketdi. Bir daqiqadan keyin qayta urinib ko'ring.",
    ru: 'Что-то пошло не так. Попробуйте через минуту.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    readonly field?: string,
  ) {
    super(code);
    this.name = 'DomainError';
  }

  get httpStatus(): number {
    return ERROR_MESSAGES[this.code].http;
  }
}

export function errorMessage(
  code: ErrorCode,
  locale: Locale,
  vars: Record<string, string> = {},
): string {
  const template = ERROR_MESSAGES[code][locale];
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** Wire shape of API errors (RFC 7807-like, docs/05). */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; field?: string; details?: Record<string, unknown> };
}
