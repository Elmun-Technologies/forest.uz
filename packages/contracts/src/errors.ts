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
  DELIVERY_INVALID_TRANSITION: {
    http: 409,
    uz: "Yetkazish holatini bunday o'zgartirib bo'lmaydi.",
    ru: 'Нельзя изменить статус доставки таким образом.',
  },
  SHIPMENT_ORDER_NOT_READY: {
    http: 409,
    uz: "Buyurtma hali tasdiqlanmagan yoki bekor qilingan — jo'natib bo'lmaydi.",
    ru: 'Заказ ещё не подтверждён или отменён — отправить его нельзя.',
  },
  SHIPMENT_CARRIER_MISMATCH: {
    http: 409,
    uz: "Bu buyurtma boshqa yetkazib beruvchi orqali jo'natiladi.",
    ru: 'Этот заказ отправляется другой службой доставки.',
  },
  FISCAL_RECEIPT_REQUIRED: {
    http: 409,
    uz: 'Buyurtmani yopish uchun fiskal chek kerak. Avval chek raqami yoki havolasini kiriting.',
    ru: 'Чтобы закрыть заказ, нужен фискальный чек. Сначала укажите номер или ссылку чека.',
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
  OTP_LOCKED: {
    http: 429,
    uz: "Xavfsizlik uchun bu raqamga kirish vaqtincha yopildi. Keyinroq urinib ko'ring yoki operatorga yozing.",
    ru: 'В целях безопасности вход по этому номеру временно закрыт. Попробуйте позже или напишите оператору.',
  },
  CHECKOUT_LIMITED: {
    http: 429,
    uz: "Buyurtmalar juda ko'p yuborildi. Birozdan keyin urinib ko'ring yoki operatorga qo'ng'iroq qiling.",
    ru: 'Слишком много заказов подряд. Попробуйте чуть позже или позвоните оператору.',
  },
  COD_OPEN_ORDERS_LIMIT: {
    http: 409,
    uz: "Bu raqamda tasdiqlanmagan buyurtmalar bor. Operator qo'ng'irog'ini kuting yoki onlayn to'lang.",
    ru: 'На этот номер уже есть неподтверждённые заказы. Дождитесь звонка оператора или оплатите онлайн.',
  },
  PAYMENT_METHOD_UNAVAILABLE: {
    http: 400,
    uz: "Bu to'lov usuli hozircha ishlamayapti. Boshqa usulni tanlang.",
    ru: 'Этот способ оплаты сейчас недоступен. Выберите другой.',
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
  IDEMPOTENCY_CONFLICT: {
    http: 409,
    uz: 'Bu buyurtma allaqachon yuborilmoqda. Bir necha soniya kuting.',
    ru: 'Этот заказ уже отправляется. Подождите несколько секунд.',
  },
  IKPU_MISSING: {
    http: 409,
    uz: "Mahsulot hozircha sotuvga tayyor emas. Operator bilan bog'laning.",
    ru: 'Товар пока не готов к продаже. Свяжитесь с оператором.',
  },
  PAYMENT_NOT_RETRYABLE: {
    http: 409,
    uz: "Bu buyurtma uchun to'lovni qayta boshlab bo'lmaydi.",
    ru: 'Оплату этого заказа нельзя начать заново.',
  },
  REFUND_AMOUNT_INVALID: {
    http: 400,
    uz: "Qaytariladigan summa noto'g'ri: u 0 dan katta va to'langan qoldiqdan oshmasligi kerak.",
    ru: 'Неверная сумма возврата: она должна быть больше 0 и не больше оплаченного остатка.',
  },
  REFUND_NOT_ALLOWED: {
    http: 409,
    uz: "Bu to'lovni hozir qaytarib bo'lmaydi. Buyurtma holatini tekshiring.",
    ru: 'Этот платёж сейчас нельзя вернуть. Проверьте статус заказа.',
  },
  REFUND_VIA_PROVIDER_CABINET: {
    http: 409,
    uz: "Payme to'lovi Payme kabinetida bekor qilinadi — qaytarish avtomatik qayd etiladi.",
    ru: 'Платёж Payme отменяется в кабинете Payme — возврат будет записан автоматически.',
  },
  COD_DISABLED: {
    http: 400,
    uz: "Hozircha faqat onlayn to'lov mavjud.",
    ru: 'Сейчас доступна только онлайн-оплата.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    http: 400,
    uz: "So'rov kaliti yo'q.",
    ru: 'Отсутствует ключ идемпотентности.',
  },
  TELEGRAM_AUTH_INVALID: {
    http: 401,
    uz: "Telegram orqali kirishni tasdiqlab bo'lmadi. Qayta urinib ko'ring yoki telefon raqam bilan kiring.",
    ru: 'Не удалось подтвердить вход через Telegram. Попробуйте ещё раз или войдите по номеру телефона.',
  },
  TELEGRAM_AUTH_EXPIRED: {
    http: 401,
    uz: "Telegram ma'lumotlari eskirgan. «Telegram orqali kirish» tugmasini qayta bosing.",
    ru: 'Данные Telegram устарели. Нажмите «Войти через Telegram» ещё раз.',
  },
  TELEGRAM_ALREADY_LINKED: {
    http: 409,
    uz: "Bu Telegram akkaunt boshqa mijozga ulangan. Operator bilan bog'laning.",
    ru: 'Этот аккаунт Telegram привязан к другому клиенту. Свяжитесь с оператором.',
  },
  INTEGRATION_NOT_CONFIGURED: {
    http: 503,
    uz: 'Xizmat hali ulanmagan.',
    ru: 'Сервис ещё не подключён.',
  },
  DELIVERY_CLAIM_NOT_READY: {
    http: 409,
    uz: "Yandex hali narxni hisoblamadi yoki taklif eskirdi. Bir daqiqadan keyin qayta urinib ko'ring.",
    ru: 'Яндекс ещё не рассчитал заявку или предложение устарело. Попробуйте через минуту.',
  },
  DELIVERY_TEST_MODE: {
    http: 409,
    uz: "Test rejimida kuryer chaqirilmaydi. Integratsiyani «live» rejimiga o'tkazing.",
    ru: 'В тестовом режиме курьер не вызывается. Переключите интеграцию в режим «live».',
  },
  DELIVERY_COD_UNSUPPORTED: {
    http: 409,
    uz: "Naqd to'lovli buyurtmalar uchun Yandex kuryeri yoqilmagan.",
    ru: 'Курьер Яндекса для заказов с оплатой при получении не включён.',
  },
  DELIVERY_CANCEL_UNAVAILABLE: {
    http: 409,
    uz: "Kuryer chaqiruvini endi bekor qilib bo'lmaydi — Yandex qo'llab-quvvatlash xizmatiga murojaat qiling.",
    ru: 'Вызов курьера уже нельзя отменить — обратитесь в поддержку Яндекса.',
  },
  DELIVERY_CANCEL_PAID: {
    http: 409,
    uz: "Bekor qilish pullik. Tasdiqlasangiz, to'lov bilan bekor qilinadi.",
    ru: 'Отмена платная. Подтвердите, чтобы отменить с оплатой.',
  },
  DELIVERY_PROVIDER_ERROR: {
    http: 502,
    uz: "Yetkazish xizmati javob bermadi. Birozdan keyin qayta urinib ko'ring.",
    ru: 'Служба доставки не ответила. Попробуйте чуть позже.',
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
