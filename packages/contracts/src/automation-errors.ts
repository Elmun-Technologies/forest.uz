/** Phase 5C error codes (webhooks, API keys, CMS, AI drafts), spread into ADMIN_ERROR_MESSAGES. */
export const AUTOMATION_ERROR_MESSAGES = {
  WEBHOOK_URL_INVALID: {
    http: 400,
    uz: "Manzil https:// bilan boshlanadigan ochiq internet manzili bo'lishi kerak.",
    ru: 'Адрес должен быть публичным https:// адресом.',
  },
  WEBHOOK_LIMIT: {
    http: 409,
    uz: "Webhooklar soni chegarasiga yetildi. Keraksizini o'chiring.",
    ru: 'Достигнут лимит вебхуков. Удалите ненужные.',
  },
  API_KEY_INVALID: {
    http: 401,
    uz: "API kalit noto'g'ri yoki bekor qilingan.",
    ru: 'API-ключ неверный или отозван.',
  },
  API_KEY_SCOPE: {
    http: 403,
    uz: "Bu API kalitda shu ma'lumotga ruxsat yo'q.",
    ru: 'У этого API-ключа нет доступа к этим данным.',
  },
  API_KEY_LIMIT: {
    http: 409,
    uz: 'Faol API kalitlar soni chegarasiga yetildi. Keraksizini bekor qiling.',
    ru: 'Достигнут лимит активных API-ключей. Отзовите ненужные.',
  },
  PAGE_SLUG_TAKEN: {
    http: 409,
    uz: 'Bu manzil (slug) boshqa maqolada band. Boshqasini tanlang.',
    ru: 'Этот адрес (slug) уже занят другой статьёй. Выберите другой.',
  },
  PAGE_FILE_INVALID: {
    http: 400,
    uz: 'Rasm topilmadi. Rasmni qayta yuklang.',
    ru: 'Изображение не найдено. Загрузите его заново.',
  },
  AI_DRAFT_LIMITED: {
    http: 429,
    uz: "AI so'rovlari chegarasiga yetildi. Birozdan keyin urinib ko'ring.",
    ru: 'Достигнут лимит AI-запросов. Попробуйте чуть позже.',
  },
  AI_DRAFT_FAILED: {
    http: 502,
    uz: "AI qoralama tayyorlay olmadi. Keyinroq urinib ko'ring yoki o'zingiz yozing.",
    ru: 'AI не смог подготовить черновик. Попробуйте позже или напишите сами.',
  },
  AI_DRAFT_NO_SOURCE: {
    http: 400,
    uz: "Qoralama uchun ma'lumot yetarli emas: avval nom va qisqa tavsifni to'ldiring.",
    ru: 'Недостаточно данных для черновика: сначала заполните название и краткое описание.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
