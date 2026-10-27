/**
 * Admin error codes for customers (A4/A5), settings (A16) and the integrations hub (A10), spread
 * into `ADMIN_ERROR_MESSAGES`. Uzbek is the admin language; `ru` keeps the shape uniform.
 */
export const ADMIN_CRM_ERROR_MESSAGES = {
  CUSTOMER_HAS_OPEN_ORDERS: {
    http: 409,
    uz: "Mijozning yakunlanmagan buyurtmasi bor. Buyurtma yopilgach ma'lumotlarni o'chirish mumkin.",
    ru: 'У клиента есть незавершённый заказ. Данные можно удалить после его закрытия.',
  },
  CUSTOMER_ERASED: {
    http: 409,
    uz: "Bu mijozning ma'lumotlari allaqachon o'chirilgan.",
    ru: 'Данные этого клиента уже удалены.',
  },
  ADMIN_CONFIRM_MISMATCH: {
    http: 400,
    uz: "Tasdiqlash matni mos kelmadi. Ko'rsatilgan qiymatni aynan kiriting.",
    ru: 'Текст подтверждения не совпал. Введите указанное значение точно.',
  },
  SETTINGS_CONFLICT: {
    http: 409,
    uz: "Sozlamalarni boshqa xodim hozirgina o'zgartirdi. Sahifani yangilab, qayta kiriting.",
    ru: 'Настройки только что изменил другой сотрудник. Обновите страницу и повторите.',
  },
  INTEGRATION_NOT_CONNECTABLE: {
    http: 409,
    uz: "Bu integratsiyani hozircha ulab bo'lmaydi (tez orada).",
    ru: 'Эту интеграцию пока нельзя подключить (скоро).',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
