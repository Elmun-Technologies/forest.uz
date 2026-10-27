import type { Locale } from '@forest/contracts';

/**
 * Bot UI copy (CLAUDE.md §6, 5A): command replies, prompts and button labels. The flow message
 * bodies themselves are A12-editable `MessageTemplate`s; these short strings frame them. Order
 * status labels match the storefront cabinet (`apps/web/messages/*.json` `account.status`).
 */
const UZ = {
  shareButton: 'Raqamni ulashish',
  adviceButton: 'Rang maslahati',
  deliveryButton: "Yetkazish va to'lov",
  copyCode: 'Kodni nusxalash',
  pickItem: 'Buyumni tanlash ↗',
  sharePhone:
    "Kod SMS'da ham kelishi va buyurtma holatini shu yerda olishingiz uchun raqamingizni ulashing.",
  phoneThanks:
    'Rahmat! Endi buyurtma holatlari shu yerga keladi. Buyumingiz rasmini yuboring — mutaxassis rang tanlashga yordam beradi.',
  contactNotOwn: "Iltimos, o'z raqamingizni «Raqamni ulashish» tugmasi orqali yuboring.",
  contactInvalid:
    "Bu raqam O'zbekiston raqamiga o'xshamaydi. Buyurtma berishda saytda boshqa raqam ko'rsatishingiz mumkin.",
  contactConflict:
    'Bu Telegram allaqachon boshqa hisobga ulangan. Operatorga yozing — yordam beramiz.',
  welcome:
    'Assalomu alaykum! Bu Forest xizmat boti: buyurtma holati, rang maslahati va natija baholari shu yerda.',
  advicePrompt: 'Buyumingiz rasmini yuboring va savolingizni yozing — mutaxassis javob beradi.',
  deliveryInfo:
    "Toshkent bo'ylab 12 soatda, viloyatlarga 24 soatda yetkazamiz. To'lov: Payme, Click yoki olganda naqd.",
  moreOnSite: 'Batafsil saytda ↗',
  ordersHeader: 'Buyurtmalaringiz:',
  ordersEmpty: "Sizda hali buyurtma yo'q.",
  ordersNeedPhone: "Buyurtmalarni ko'rish uchun raqamingizni ulashing.",
  track: 'Kuzatish ↗',
  writeOperator: 'Operatorga yozish',
  help: 'Savolingizni yozing — operator javob beradi.',
  hours: 'Ish vaqti',
  langPrompt: 'Tilni tanlang:',
  langSet: "Til o'zgartirildi: o'zbekcha.",
  stopDone:
    "Eslatmalar o'chirildi. Buyurtma holatlari kelishda davom etadi. Qayta yoqish uchun /start yuboring.",
  resubscribed: 'Eslatmalar yana yoqildi.',
  reviewAlready: 'Bu buyurtmaga baho allaqachon berilgan. Rahmat!',
  reviewStale: "Bu so'rov eskirgan.",
  consentYes: 'Ha, roziman',
  consentNo: "Yo'q, rahmat",
  reviewConsentYes: "Rahmat! Foto tekshiruvdan so'ng saytdagi «Natijalar» bo'limida chiqadi.",
  reviewConsentNo: 'Tushunarli, foto faqat bizda qoladi. Rahmat!',
  reviewTextThanks: 'Fikringiz uchun rahmat!',
  photoFailed: "Rasmni qabul qilib bo'lmadi. JPG yoki PNG rasm yuboring (10 MB gacha).",
  cartQuestion: 'Savolim bor',
  stopButton: "Eslatmani o'chirish",
  cartAsk: 'Savolingizni yozing — operator javob beradi.',
  cartSummary: 'Savatda: {n} ta mahsulot · {sum}',
  cartDelivery: 'Toshkentda 12 soatda yetkazamiz.',
  finishOrder: 'Buyurtmani yakunlash ↗',
  addToCart: "Savatga qo'shish ↗",
  orderTitle: 'Buyurtma {raqam}',
  orderTotal: 'Jami',
  courier: 'Kuryer',
  eta: 'Taxminan {vaqt} da yetib boradi',
  specialist: 'Forest mutaxassisi',
  stars: 'Natijani baholang:',
} as const;

type Copy = { [K in keyof typeof UZ]: string };

const RU: Copy = {
  shareButton: 'Поделиться номером',
  adviceButton: 'Совет по цвету',
  deliveryButton: 'Доставка и оплата',
  copyCode: 'Скопировать код',
  pickItem: 'Выбрать вещь ↗',
  sharePhone: 'Поделитесь номером, чтобы код пришёл и по SMS, а статусы заказа приходили сюда.',
  phoneThanks:
    'Спасибо! Теперь статусы заказов будут приходить сюда. Пришлите фото вещи — специалист поможет подобрать цвет.',
  contactNotOwn: 'Пожалуйста, отправьте свой номер кнопкой «Поделиться номером».',
  contactInvalid:
    'Этот номер не похож на узбекский. При заказе на сайте можно указать другой номер.',
  contactConflict: 'Этот Telegram уже привязан к другому аккаунту. Напишите оператору — поможем.',
  welcome:
    'Здравствуйте! Это сервисный бот Forest: статусы заказов, советы по цвету и оценки результата.',
  advicePrompt: 'Пришлите фото вещи и напишите вопрос — специалист ответит.',
  deliveryInfo:
    'По Ташкенту доставляем за 12 часов, в регионы — за 24 часа. Оплата: Payme, Click или наличными при получении.',
  moreOnSite: 'Подробнее на сайте ↗',
  ordersHeader: 'Ваши заказы:',
  ordersEmpty: 'У вас пока нет заказов.',
  ordersNeedPhone: 'Чтобы увидеть заказы, поделитесь номером.',
  track: 'Отследить ↗',
  writeOperator: 'Написать оператору',
  help: 'Напишите вопрос — оператор ответит.',
  hours: 'Часы работы',
  langPrompt: 'Выберите язык:',
  langSet: 'Язык изменён: русский.',
  stopDone:
    'Напоминания отключены. Статусы заказов будут приходить как прежде. Чтобы включить снова, отправьте /start.',
  resubscribed: 'Напоминания снова включены.',
  reviewAlready: 'Оценка за этот заказ уже получена. Спасибо!',
  reviewStale: 'Этот запрос устарел.',
  consentYes: 'Да, согласен(на)',
  consentNo: 'Нет, спасибо',
  reviewConsentYes: 'Спасибо! После проверки фото появится в разделе «Результаты» на сайте.',
  reviewConsentNo: 'Понятно, фото останется только у нас. Спасибо!',
  reviewTextThanks: 'Спасибо за отзыв!',
  photoFailed: 'Не удалось принять фото. Пришлите JPG или PNG (до 10 МБ).',
  cartQuestion: 'У меня вопрос',
  stopButton: 'Отключить напоминания',
  cartAsk: 'Напишите вопрос — оператор ответит.',
  cartSummary: 'В корзине: {n} шт. · {sum}',
  cartDelivery: 'По Ташкенту доставим за 12 часов.',
  finishOrder: 'Завершить заказ ↗',
  addToCart: 'Добавить в корзину ↗',
  orderTitle: 'Заказ {raqam}',
  orderTotal: 'Итого',
  courier: 'Курьер',
  eta: 'Прибудет примерно в {vaqt}',
  specialist: 'специалист Forest',
  stars: 'Оцените результат:',
};

export const BOT_ORDER_STATUS: Record<Locale, Record<string, string>> = {
  uz: {
    NEW: 'Yangi',
    CONFIRMED: 'Tasdiqlandi',
    PACKING: "Yig'ilmoqda",
    READY: "Yig'ildi",
    HANDED_TO_COURIER: "Yo'lda",
    DELIVERED: 'Yetkazildi',
    COMPLETED: 'Yakunlandi',
    CANCELLED: 'Bekor qilindi',
    RETURN_REQUESTED: "Qaytarish so'raldi",
    RETURNED: 'Qaytarildi',
  },
  ru: {
    NEW: 'Новый',
    CONFIRMED: 'Подтверждён',
    PACKING: 'Собирается',
    READY: 'Собран',
    HANDED_TO_COURIER: 'В пути',
    DELIVERED: 'Доставлен',
    COMPLETED: 'Завершён',
    CANCELLED: 'Отменён',
    RETURN_REQUESTED: 'Запрошен возврат',
    RETURNED: 'Возвращён',
  },
};

const COPY: Record<Locale, Copy> = { uz: UZ, ru: RU };

/** Copy string with `{name}` slots filled. */
export function copy(
  locale: Locale,
  key: keyof typeof UZ,
  vars: Record<string, string | number> = {},
): string {
  return COPY[locale][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Reply-keyboard labels in both languages (a customer may tap an old keyboard after /til). */
export function isCopyLabel(text: string, key: 'adviceButton' | 'deliveryButton'): boolean {
  return text === UZ[key] || text === RU[key];
}

/** Telegram HTML parse mode: only these three characters need escaping. */
export function html(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
