/** Session replay upload and A3 error codes, merged into `ADMIN_ERROR_MESSAGES`. */
export const HEATMAP_ERROR_MESSAGES = {
  REPLAY_NOT_ALLOWED: {
    http: 403,
    uz: "Sessiya yozuvi bu tashrif uchun o'chirilgan.",
    ru: 'Запись сессии для этого визита отключена.',
  },
  REPLAY_SESSION_UNKNOWN: {
    http: 409,
    uz: "Sessiya hali ro'yxatga olinmagan. Birozdan keyin qayta yuboriladi.",
    ru: 'Сессия ещё не зарегистрирована. Повторим чуть позже.',
  },
  REPLAY_CHUNK_INVALID: {
    http: 400,
    uz: "Yozuv bo'lagi noto'g'ri.",
    ru: 'Неверный фрагмент записи.',
  },
  REPLAY_CONTENT_TYPE: {
    http: 415,
    uz: "Yozuv bo'lagi application/octet-stream bo'lishi kerak.",
    ru: 'Фрагмент записи должен быть application/octet-stream.',
  },
  REPLAY_TOO_LARGE: {
    http: 413,
    uz: 'Yozuv hajmi chegaradan oshdi.',
    ru: 'Объём записи превышает лимит.',
  },
  REPLAY_NOT_FOUND: {
    http: 404,
    uz: "Bu sessiya uchun yozuv yo'q yoki muddati tugagan (30 kun).",
    ru: 'Для этой сессии нет записи или срок хранения истёк (30 дней).',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
