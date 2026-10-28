/** Telegram bot / A12 inbox error codes (5A), spread into `ADMIN_ERROR_MESSAGES`. */
export const BOT_ERROR_MESSAGES = {
  BOT_SEND_FAILED: {
    http: 502,
    uz: "Xabar Telegramga yuborilmadi (mijoz botni bloklagan bo'lishi mumkin). Keyinroq urinib ko'ring.",
    ru: 'Сообщение не отправлено в Telegram (клиент мог заблокировать бота). Попробуйте позже.',
  },
  BOT_NOT_CONNECTED: {
    http: 409,
    uz: "Telegram bot ulanmagan. Integratsiyalar bo'limida bot tokenini kiriting.",
    ru: 'Telegram-бот не подключён. Укажите токен бота в разделе «Интеграции».',
  },
  BOT_CONVERSATION_NOT_FOUND: {
    http: 404,
    uz: 'Suhbat topilmadi.',
    ru: 'Диалог не найден.',
  },
  CART_LINK_INVALID: {
    http: 400,
    uz: "Savat havolasi eskirgan yoki noto'g'ri.",
    ru: 'Ссылка на корзину устарела или неверна.',
  },
} as const;
