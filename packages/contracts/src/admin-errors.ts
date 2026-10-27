import { ADMIN_ANALYTICS_ERROR_MESSAGES } from './admin-analytics-errors';
import { AUTOMATION_ERROR_MESSAGES } from './automation-errors';
import { ADMIN_AUDIENCES_ERROR_MESSAGES } from './admin-audiences-errors';
import { ADMIN_CATALOG_ERROR_MESSAGES } from './admin-catalog-errors';
import { BOT_ERROR_MESSAGES } from './bot-errors';
import { ADMIN_CRM_ERROR_MESSAGES } from './admin-crm-errors';
import { ADMIN_MOYSKLAD_ERROR_MESSAGES } from './admin-moysklad-errors';
import { HEATMAP_ERROR_MESSAGES } from './heatmap-errors';
import { ADMIN_ORDERS_ERROR_MESSAGES } from './admin-orders-errors';
import { ADMIN_SEO_ERROR_MESSAGES } from './admin-seo-errors';
import { MESSAGING_ERROR_MESSAGES } from './messaging-errors';

/**
 * Admin error codes, merged into `ERROR_MESSAGES` (errors.ts). Kept apart so the admin area grows
 * without touching the shared catalogue. The admin UI is Uzbek; `ru` keeps the shape uniform.
 */
export const ADMIN_ERROR_MESSAGES = {
  ADMIN_LOGIN_FAILED: {
    http: 401,
    // One message for unknown email, wrong password and a locked account (no account probing).
    uz: "Email yoki parol noto'g'ri. Ko'p xato urinishdan keyin kirish 15 daqiqaga yopiladi.",
    ru: 'Неверный email или пароль. После многих ошибок вход закрывается на 15 минут.',
  },
  ADMIN_TOTP_REQUIRED: {
    http: 401,
    uz: 'Ilovadagi 6 xonali kodni kiriting.',
    ru: 'Введите 6-значный код из приложения.',
  },
  ADMIN_TOTP_SETUP_REQUIRED: {
    http: 403,
    uz: 'Avval ikki bosqichli himoyani (2FA) yoqing.',
    ru: 'Сначала включите двухэтапную защиту (2FA).',
  },
  ADMIN_TOTP_INVALID: {
    http: 400,
    uz: "Kod noto'g'ri yoki ishlatilgan. Ilovadagi yangi kodni kiriting.",
    ru: 'Код неверный или уже использован. Введите новый код из приложения.',
  },
  ADMIN_TOTP_NOT_STARTED: {
    http: 409,
    uz: '2FA sozlanmagan. Avval QR kodni oling.',
    ru: '2FA не настроена. Сначала получите QR-код.',
  },
  ADMIN_TOTP_ALREADY_ENABLED: {
    http: 409,
    uz: '2FA allaqachon yoqilgan. Qayta sozlash uchun Egasiga murojaat qiling.',
    ru: '2FA уже включена. Для перенастройки обратитесь к владельцу.',
  },
  ADMIN_CSRF_INVALID: {
    http: 403,
    uz: "Sahifa eskirgan. Sahifani yangilab, qayta urinib ko'ring.",
    ru: 'Страница устарела. Обновите её и попробуйте снова.',
  },
  ADMIN_INVITE_INVALID: {
    http: 404,
    uz: "Taklif havolasi eskirgan yoki ishlatilgan. Egasidan yangi havola so'rang.",
    ru: 'Ссылка-приглашение устарела или уже использована. Попросите новую у владельца.',
  },
  ADMIN_PASSWORD_WEAK: {
    http: 400,
    uz: "Parol kamida 12 belgidan iborat bo'lsin, ismingiz yoki oddiy so'zlarsiz.",
    ru: 'Пароль — не короче 12 символов, без вашего имени и простых слов.',
  },
  ADMIN_STAFF_EXISTS: {
    http: 409,
    uz: 'Bu email bilan xodim allaqachon bor.',
    ru: 'Сотрудник с таким email уже есть.',
  },
  ADMIN_SELF_CHANGE: {
    http: 409,
    uz: "O'z rolingiz va holatingizni o'zgartirib bo'lmaydi.",
    ru: 'Нельзя изменить собственную роль или статус.',
  },
  ADMIN_LAST_OWNER: {
    http: 409,
    uz: 'Kamida bitta faol Egasi qolishi kerak.',
    ru: 'Должен остаться хотя бы один активный владелец.',
  },
  ADMIN_INVITE_NOT_PENDING: {
    http: 409,
    uz: 'Bu xodim taklifni allaqachon qabul qilgan.',
    ru: 'Этот сотрудник уже принял приглашение.',
  },
  ...ADMIN_CATALOG_ERROR_MESSAGES,
  ...ADMIN_CRM_ERROR_MESSAGES,
  ...ADMIN_ORDERS_ERROR_MESSAGES,
  ...ADMIN_MOYSKLAD_ERROR_MESSAGES,
  ...HEATMAP_ERROR_MESSAGES,
  ...ADMIN_ANALYTICS_ERROR_MESSAGES,
  ...ADMIN_AUDIENCES_ERROR_MESSAGES,
  ...ADMIN_SEO_ERROR_MESSAGES,
  ...MESSAGING_ERROR_MESSAGES,
  ...AUTOMATION_ERROR_MESSAGES,
  ...BOT_ERROR_MESSAGES,
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
