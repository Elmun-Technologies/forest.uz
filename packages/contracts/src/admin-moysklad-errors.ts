/**
 * Admin A13 MoySklad error codes, spread into `ADMIN_ERROR_MESSAGES`. Uzbek is the admin language;
 * `ru` keeps the shape uniform.
 */
export const ADMIN_MOYSKLAD_ERROR_MESSAGES = {
  MOYSKLAD_NOT_CONNECTED: {
    http: 409,
    uz: "MoySklad ulanmagan. Avval Integratsiyalar bo'limida API tokenni kiriting.",
    ru: 'МойСклад не подключён. Сначала введите API-токен в разделе «Интеграции».',
  },
  MOYSKLAD_WEBHOOK_URL_UNAVAILABLE: {
    http: 409,
    uz: 'Webhook uchun API manzili https bilan boshlanishi va 255 belgidan oshmasligi kerak.',
    ru: 'Для вебхука адрес API должен начинаться с https и быть не длиннее 255 символов.',
  },
  MOYSKLAD_PROVIDER_ERROR: {
    http: 502,
    uz: "MoySklad javob bermadi yoki so'rovni rad etdi. Birozdan keyin qayta urinib ko'ring.",
    ru: 'МойСклад не ответил или отклонил запрос. Повторите попытку позже.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
