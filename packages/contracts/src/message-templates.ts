import type { Locale } from './locale';

/**
 * Message template catalog (A12, docs/09): what each `MessageTemplate.key` is for, which
 * variables it may use and how the messaging engine treats it. Zod-free (admin preview + API).
 *
 * Kinds (docs/02 "Messaging"): `service` = order status and bot replies, always allowed;
 * `requested` = the customer asked for exactly this message (waitlist, lead code) — no marketing
 * consent or cap, quiet hours still apply; `marketing` = consent per channel, daily cap, quiet
 * hours and an opt-out on every message.
 */
export type MessageKind = 'service' | 'requested' | 'marketing';
export type MessageChannelKey = 'TELEGRAM' | 'SMS';
export type MessageScenario =
  'auth' | 'lead' | 'order' | 'cart' | 'advice' | 'review' | 'waitlist' | 'audience';

/** The variables the A12 editor offers (docs/08). */
export const TEMPLATE_VARIABLES = ['ism', 'mahsulot', 'raqam', 'kod', 'link', 'vaqt'] as const;

/**
 * Opt-out slot: the engine fills it with the customer's `/obuna/<token>` link. Every marketing
 * template that can go by SMS must contain it, so the opt-out is part of the text Eskiz approves
 * (Eskiz rejects texts that differ from the approved template).
 */
export const OPT_OUT_VARIABLE = 'stop';

export interface MessageTemplateMeta {
  kind: MessageKind;
  scenario: MessageScenario;
  /** Uzbek admin label. */
  label: string;
  /** Variables the engine fills for this key; anything else is rejected on save. */
  vars: readonly string[];
  /** Variables the text must contain (an OTP without `{kod}` is useless). */
  required?: readonly string[];
  channels: readonly MessageChannelKey[];
}

const ORDER_VARS = ['ism', 'raqam', 'link'] as const;
const T: readonly MessageChannelKey[] = ['TELEGRAM'];
const S: readonly MessageChannelKey[] = ['SMS'];
const TS: readonly MessageChannelKey[] = ['TELEGRAM', 'SMS'];

export const MESSAGE_TEMPLATES: Record<string, MessageTemplateMeta> = {
  otp: {
    kind: 'service',
    scenario: 'auth',
    label: 'Kirish kodi (OTP)',
    vars: ['kod'],
    required: ['kod'],
    channels: S,
  },
  lead_welcome: {
    kind: 'requested',
    scenario: 'lead',
    label: 'Lead: salomlashish va kod',
    vars: ['ism', 'kod', 'link'],
    channels: T,
  },
  lead_promo_sms: {
    kind: 'requested',
    scenario: 'lead',
    label: 'Lead: promokod SMS',
    vars: ['kod', 'link'],
    required: ['kod'],
    channels: S,
  },
  order_created: {
    kind: 'service',
    scenario: 'order',
    label: 'Buyurtma qabul qilindi',
    vars: ORDER_VARS,
    channels: TS,
  },
  order_phone_created: {
    kind: 'service',
    scenario: 'order',
    label: 'Telefon orqali buyurtma qabul qilindi',
    vars: ORDER_VARS,
    channels: TS,
  },
  order_paid: {
    kind: 'service',
    scenario: 'order',
    label: "To'lov qabul qilindi",
    vars: ORDER_VARS,
    channels: TS,
  },
  order_confirmed: {
    kind: 'service',
    scenario: 'order',
    label: 'Buyurtma tasdiqlandi (naqd)',
    vars: ORDER_VARS,
    channels: TS,
  },
  payment_reminder: {
    kind: 'service',
    scenario: 'order',
    label: "To'lov eslatmasi",
    vars: [...ORDER_VARS, 'vaqt'],
    channels: TS,
  },
  order_courier: {
    kind: 'service',
    scenario: 'order',
    label: "Kuryer yo'lda (vaqt bilan)",
    vars: [...ORDER_VARS, 'vaqt'],
    channels: TS,
  },
  order_shipped: {
    kind: 'service',
    scenario: 'order',
    label: 'Kuryerga topshirildi',
    vars: ORDER_VARS,
    channels: TS,
  },
  order_shipped_bts: {
    kind: 'service',
    scenario: 'order',
    label: "BTS orqali jo'natildi",
    vars: [...ORDER_VARS, 'trek'],
    channels: TS,
  },
  order_at_branch: {
    kind: 'service',
    scenario: 'order',
    label: 'BTS filialida',
    vars: [...ORDER_VARS, 'filial'],
    channels: TS,
  },
  order_delivered: {
    kind: 'service',
    scenario: 'order',
    label: 'Yetkazildi',
    vars: ORDER_VARS,
    channels: TS,
  },
  order_delivery_failed: {
    kind: 'service',
    scenario: 'order',
    label: "Yetkazib bo'lmadi",
    vars: ORDER_VARS,
    channels: TS,
  },
  order_cancelled: {
    kind: 'service',
    scenario: 'order',
    label: 'Buyurtma bekor qilindi',
    vars: ORDER_VARS,
    channels: TS,
  },
  cart_abandoned_2h: {
    kind: 'marketing',
    scenario: 'cart',
    label: 'Tashlangan savat (Telegram)',
    vars: ['ism', 'mahsulot', 'kod', 'link'],
    channels: T,
  },
  cart_abandoned_24h_sms: {
    kind: 'marketing',
    scenario: 'cart',
    label: 'Tashlangan savat (SMS)',
    vars: ['ism', 'mahsulot', 'kod', 'link', 'stop'],
    required: ['stop'],
    channels: S,
  },
  advice_received: {
    kind: 'service',
    scenario: 'advice',
    label: 'Maslahat: rasm qabul qilindi',
    vars: ['ism'],
    channels: T,
  },
  advice_off_hours: {
    kind: 'service',
    scenario: 'advice',
    label: 'Ish vaqtidan tashqari javob',
    vars: ['ism'],
    channels: T,
  },
  review_request: {
    kind: 'marketing',
    scenario: 'review',
    label: "Sharh so'rovi (Telegram)",
    vars: ['ism', 'raqam', 'mahsulot', 'link'],
    channels: T,
  },
  review_request_sms: {
    kind: 'marketing',
    scenario: 'review',
    label: "Sharh so'rovi (SMS)",
    vars: ['ism', 'raqam', 'link', 'stop'],
    required: ['stop'],
    channels: S,
  },
  review_thanks_high: {
    kind: 'service',
    scenario: 'review',
    label: 'Sharh: rahmat (4–5★)',
    vars: ['ism'],
    channels: T,
  },
  review_photo_code: {
    kind: 'service',
    scenario: 'review',
    label: 'Sharh: foto uchun kod',
    vars: ['ism', 'kod'],
    channels: T,
  },
  review_low_apology: {
    kind: 'service',
    scenario: 'review',
    label: 'Sharh: uzr (1–3★)',
    vars: ['ism'],
    channels: T,
  },
  waitlist_back: {
    kind: 'requested',
    scenario: 'waitlist',
    label: 'Mahsulot yana omborda',
    vars: ['ism', 'mahsulot', 'link'],
    channels: TS,
  },
};

/** Admin-created marketing templates for audience automations (A8 auto message). */
export const CUSTOM_TEMPLATE_PREFIX = 'custom_';
export const CUSTOM_TEMPLATE_KEY_RE = /^custom_[a-z0-9_]{2,40}$/;
const CUSTOM_META: MessageTemplateMeta = {
  kind: 'marketing',
  scenario: 'audience',
  label: 'Auditoriya xabari',
  vars: ['ism', 'link', 'stop'],
  required: ['stop'],
  channels: TS,
};

/** Catalog entry for a key; custom templates share one meta; unknown keys → null. */
export function templateMeta(key: string): MessageTemplateMeta | null {
  if (key.startsWith(CUSTOM_TEMPLATE_PREFIX)) return CUSTOM_META;
  return MESSAGE_TEMPLATES[key] ?? null;
}

const VAR_RE = /\{([a-zA-Z0-9_]+)\}/g;

/** Variable names used in `text` (in order of first appearance). */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]!))];
}

/** Telegram caps a message at 4096 characters; a caption (photo) at 1024. */
export const TEMPLATE_BODY_MAX = 1000;
export const TEMPLATE_BUTTON_TEXT_MAX = 40;

export interface TemplateButton {
  text: { uz: string; ru: string };
  url: string;
}

export interface TemplateProblem {
  field: string;
  code: 'empty' | 'too_long' | 'unknown_variable' | 'missing_variable' | 'button_url';
  variable?: string;
}

/** Save-time validation shared by the admin editor (live) and the API (authoritative). */
export function templateProblems(input: {
  key: string;
  body: { uz: string; ru: string };
  buttons: TemplateButton[];
}): TemplateProblem[] {
  const meta = templateMeta(input.key);
  const allowed = new Set(meta?.vars ?? []);
  const out: TemplateProblem[] = [];
  for (const locale of ['uz', 'ru'] as const) {
    const field = `body.${locale}`;
    const text = input.body[locale];
    if (!text.trim()) out.push({ field, code: 'empty' });
    if (text.length > TEMPLATE_BODY_MAX) out.push({ field, code: 'too_long' });
    for (const v of templateVariables(text))
      if (!allowed.has(v)) out.push({ field, code: 'unknown_variable', variable: v });
    for (const v of meta?.required ?? [])
      if (!templateVariables(text).includes(v))
        out.push({ field, code: 'missing_variable', variable: v });
  }
  input.buttons.forEach((b, i) => {
    for (const locale of ['uz', 'ru'] as const) {
      const field = `buttons.${i}.text.${locale}`;
      if (!b.text[locale].trim()) out.push({ field, code: 'empty' });
      if (b.text[locale].length > TEMPLATE_BUTTON_TEXT_MAX) out.push({ field, code: 'too_long' });
      if (templateVariables(b.text[locale]).length)
        out.push({
          field,
          code: 'unknown_variable',
          variable: templateVariables(b.text[locale])[0],
        });
    }
    if (!buttonUrlOk(b.url, allowed)) out.push({ field: `buttons.${i}.url`, code: 'button_url' });
  });
  return out;
}

/** A button opens `{link}` (the engine's per-message link) or a fixed https URL. */
function buttonUrlOk(url: string, allowed: Set<string>): boolean {
  if (url === '{link}') return allowed.has('link');
  return /^https:\/\/[^\s{}]+$/.test(url);
}

/**
 * Fills `{var}`s. A missing `{ism}` (customer without a name) drops the name and its comma
 * ("{ism}, savatingizda…" → "Savatingizda…"); any other missing variable → null (never send a
 * message with a hole in it).
 */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string | null {
  const has = (k: string) => vars[k] !== undefined && vars[k] !== null && vars[k] !== '';
  let src = text;
  if (!has('ism')) {
    src = src.replace(/\{ism\}\s*[,!]?\s*/g, '');
    src = src.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());
  }
  let missing = false;
  const out = src.replace(VAR_RE, (_, k: string) => {
    if (!has(k)) {
      missing = true;
      return '';
    }
    return String(vars[k]);
  });
  return missing ? null : out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Opt-out every marketing message carries (docs/09 "Eslatmani o'chirish"): Telegram gets this
 * button; SMS texts carry the `{stop}` link inside the approved template.
 */
export const MARKETING_OPT_OUT = {
  telegramButton: { uz: "Eslatmani o'chirish", ru: 'Отключить напоминания' },
} as const;

/**
 * Example values for the A12 preview and "test to myself" (labelled as an example in the UI).
 * Promo codes are the real ones of their scenario (docs/02).
 */
export function templateExampleVars(key: string, locale: Locale): Record<string, string> {
  const code: Record<string, string> = {
    cart_abandoned_2h: 'SAVAT5',
    cart_abandoned_24h_sms: 'SAVAT5',
    review_photo_code: 'RAHMAT5',
    lead_welcome: 'SALOM10',
    lead_promo_sms: 'SALOM10',
  };
  return {
    ism: locale === 'ru' ? 'Имя' : 'Ism',
    mahsulot: locale === 'ru' ? 'Название товара' : 'Mahsulot nomi',
    raqam: 'F-10001',
    kod: code[key] ?? (key === 'otp' ? '1234' : 'KOD'),
    link: 'https://forest.uz',
    vaqt: '14:30',
    trek: '123456789',
    filial: locale === 'ru' ? 'Отделение BTS' : 'BTS filiali',
    stop: `https://forest.uz/${locale}/obuna/s10001`,
  };
}
