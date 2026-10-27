/**
 * Messaging (A12 templates, automations, unsubscribe) error codes, spread into
 * `ADMIN_ERROR_MESSAGES`. `UNSUBSCRIBE_INVALID` is shown on the storefront too.
 */
export const MESSAGING_ERROR_MESSAGES = {
  MESSAGE_TEMPLATE_INVALID: {
    http: 400,
    uz: "Shablon matnini tekshiring: noma'lum o'zgaruvchi yoki bo'sh maydon bor.",
    ru: 'Проверьте текст шаблона: неизвестная переменная или пустое поле.',
  },
  MESSAGE_TEMPLATE_EXISTS: {
    http: 409,
    uz: 'Bunday kalitli shablon allaqachon bor. Boshqa nom tanlang.',
    ru: 'Шаблон с таким ключом уже есть. Выберите другое имя.',
  },
  MESSAGE_TEST_NO_CONTACT: {
    http: 400,
    uz: "Profilingizda telefon raqami yo'q: u xodim taklif qilinganda kiritiladi. Do'kon egasiga murojaat qiling.",
    ru: 'В вашем профиле нет телефона: он указывается при приглашении сотрудника. Обратитесь к владельцу.',
  },
  MESSAGE_TEST_SMS_NOT_APPROVED: {
    http: 400,
    uz: "SMS matni Eskiz'da tasdiqlanmagan. Avval tasdiqlang va «Eskiz tasdiqlagan» belgisini qo'ying.",
    ru: 'Текст SMS не одобрен в Eskiz. Сначала согласуйте его и отметьте «Одобрено Eskiz».',
  },
  MESSAGE_TEST_FAILED: {
    http: 502,
    uz: "Test xabar yuborilmadi. Integratsiya holatini tekshirib, qayta urinib ko'ring.",
    ru: 'Тестовое сообщение не отправлено. Проверьте интеграцию и попробуйте снова.',
  },
  MESSAGE_TEMPLATE_IN_USE: {
    http: 409,
    uz: 'Bu shablon auditoriya avtomatik xabarida ishlatilmoqda. Avval auditoriyadan olib tashlang.',
    ru: 'Шаблон используется в автосообщении аудитории. Сначала уберите его оттуда.',
  },
  UNSUBSCRIBE_INVALID: {
    http: 400,
    uz: "Havola eskirgan yoki noto'g'ri. Kabinet → Bildirishnomalar bo'limida o'chirishingiz mumkin.",
    ru: 'Ссылка устарела или неверна. Отключить можно в Кабинете → Уведомления.',
  },
} as const;
