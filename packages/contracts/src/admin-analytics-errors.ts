/**
 * Admin analytics (A1/A2, ad spend) error codes, spread into `ADMIN_ERROR_MESSAGES`. Uzbek is the
 * admin language; `ru` keeps the shape uniform.
 */
export const ADMIN_ANALYTICS_ERROR_MESSAGES = {
  AD_SPEND_CSV_INVALID: {
    http: 400,
    uz: 'Fayldagi qatorlarda xato bor — hech narsa saqlanmadi. Xatolarni tuzatib, qayta yuklang.',
    ru: 'В файле есть ошибки — ничего не сохранено. Исправьте строки и загрузите снова.',
  },
} as const;
