/**
 * First-party analytics vocabulary (docs/07): event names, the props each event may carry, the
 * path scrubber and the channel classifier. Zod-free (exported from `/core`) so the tracker,
 * storefront islands, the API and the reports share one definition. The zod wire schemas are in
 * `schemas/tracking.ts`.
 */

/** Sent automatically by `packages/tracker`. */
export const AUTO_EVENTS = [
  'page_view',
  'scroll_depth',
  'click',
  'rage_click',
  'dead_click',
  'form_error',
  'js_error',
  'web_vitals',
  'exit',
] as const;

/** Fired explicitly by storefront code through `track(name, props)`. */
export const COMMERCE_EVENTS = [
  'view_item_list',
  'view_item',
  'select_variant',
  'calculator_used',
  'selector_used',
  'selector_result',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'promo_applied',
  'promo_rejected',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'search',
  'waitlist_join',
  'telegram_click',
  'video_play',
] as const;

/** Written by the API only (never accepted from browsers). */
export const SERVER_EVENTS = ['purchase', 'lead'] as const;

export const TRACK_EVENT_NAMES = [...AUTO_EVENTS, ...COMMERCE_EVENTS, ...SERVER_EVENTS] as const;
export type AutoEventName = (typeof AUTO_EVENTS)[number];
export type CommerceEventName = (typeof COMMERCE_EVENTS)[number];
export type ServerEventName = (typeof SERVER_EVENTS)[number];
export type TrackEventName = (typeof TRACK_EVENT_NAMES)[number];

const COMMERCE = new Set<string>(COMMERCE_EVENTS);
/** Commerce events mark a session as engaged (not bounced). */
export const isCommerceEvent = (name: string): boolean => COMMERCE.has(name);

export const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
export const CLICK_ID_KEYS = ['gclid', 'fbclid', 'ttclid', 'yclid'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;
export type ClickIds = Partial<Record<ClickIdKey, string>>;

export type WebVitalMetric = 'LCP' | 'INP' | 'CLS';
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';
export type PaymentMethodKey = 'PAYME' | 'CLICK' | 'COD';

/**
 * Props per event (the whitelist). Never phone, name, email, address or free text typed by the
 * user — the only typed text allowed is the search `q` (≤ 100 chars). Money is in so'm (UI
 * values); server events carry tiyin strings.
 */
export interface TrackPropsMap {
  page_view: {
    /** The first page of the session: carries the acquisition context. */
    landing?: boolean;
    referrer?: string;
    utm?: Utm;
    clickIds?: ClickIds;
    nav?: 'load' | 'spa';
    locale?: 'uz' | 'ru';
  };
  scroll_depth: Record<string, never>;
  click: ClickProps;
  rage_click: ClickProps & { count?: number };
  dead_click: ClickProps;
  form_error: {
    form?: string;
    /** The field's `name`/`id` — never its value. */
    field: string;
    kind?: 'required' | 'pattern' | 'type' | 'range' | 'length' | 'invalid';
  };
  js_error: { message: string; source?: string; line?: number; col?: number };
  web_vitals: { metric: WebVitalMetric; value: number; rating: WebVitalRating };
  exit: { durationMs?: number; maxScroll?: number };

  view_item_list: { list: string; items?: string[]; count?: number };
  view_item: { productId: string; slug?: string; variantId?: string; priceSoum?: number };
  select_variant: { productId?: string; variantId: string };
  calculator_used: {
    productId?: string;
    areaM2?: number;
    coats?: number;
    liters?: number;
    preset?: string;
  };
  selector_used: { item: string };
  selector_result: { item: string; inStock?: boolean; priceSoum?: number; items?: number };
  add_to_cart: { variantId: string; qty: number; priceSoum?: number; list?: string };
  remove_from_cart: { variantId: string; qty?: number };
  view_cart: { itemsCount: number; valueSoum: number };
  /** `code` = the applied (existing) promo code; a rejected input is never sent. */
  promo_applied: { code: string; discountSoum?: number };
  promo_rejected: { reason: string };
  begin_checkout: { itemsCount: number; valueSoum: number };
  add_shipping_info: { zoneKey: string; region?: string };
  add_payment_info: { method: PaymentMethodKey };
  search: { q: string; results: number };
  waitlist_join: { variantId: string };
  telegram_click: { placement?: string };
  video_play: { placement?: string };

  purchase: {
    orderNumber: string;
    valueTiyin: string;
    currency: 'UZS';
    paymentMethod: PaymentMethodKey;
    items: { variantId: string; sku: string; qty: number; priceTiyin: string }[];
  };
  lead: { source: string };
}

export interface ClickProps {
  /** `data-track` of the clicked element or its closest ancestor. */
  track?: string;
  tag?: string;
}

export type TrackProps<N extends TrackEventName> = TrackPropsMap[N];

/** Session rules (docs/07). */
export const SESSION_IDLE_MS = 30 * 60_000;
export const TRACK_LIMITS = {
  /** Events per batch accepted by `POST /v1/t`. */
  batchEvents: 50,
  /** Body bytes accepted by `POST /v1/t`. */
  bodyBytes: 64 * 1024,
  selector: 200,
  string: 100,
  q: 100,
  message: 80,
  path: 300,
} as const;

/**
 * Capability segments: the next path segment is a secret (tracking token, order id, marketing
 * opt-out token, cart-restore token, staff invite) and is replaced by a placeholder.
 */
const SECRET_SEGMENTS: Record<string, string> = {
  t: ':token',
  buyurtma: ':id',
  obuna: ':token',
  c: ':token',
  invite: ':token',
};

const EMAIL = /[^\s@/]+@[^\s@/]+\.[a-z]{2,}/i;
/** 7+ digits possibly separated by spaces, dashes, dots or brackets, optional leading +. */
const PHONE = /(?:\+?\d[\s\-().]*){7,}/;

/**
 * js_error text: URLs without query strings, quoted fragments (values, selectors, user input)
 * and digit runs removed, at most 80 chars — enough for "TypeError: Cannot read properties…".
 */
export function cleanErrorMessage(raw: string): string {
  return raw
    .replace(/(https?:\/\/[^\s?#'"`]*)[?#][^\s'"`]*/g, '$1')
    .replace(/(["'`])[^"'`]{0,500}\1/g, '$1…$1')
    .replace(/\d{3,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** True for text that looks like a phone number or an email (PII guard for every string prop). */
export function looksLikePii(text: string): boolean {
  return EMAIL.test(text) || PHONE.test(text);
}

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Pathname only, without query/hash; capability segments (tracking token, order public id) and
 * anything that looks like a phone/email become placeholders. Used by tracker and API.
 */
export function scrubPath(raw: string): string {
  const segs = (raw.split(/[?#]/)[0] ?? '/').split('/');
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    if (!seg) continue;
    const placeholder = SECRET_SEGMENTS[segs[i - 1] ?? ''];
    if (placeholder) segs[i] = placeholder;
    else if (looksLikePii(decodeSegment(seg))) segs[i] = ':redacted';
  }
  const out = segs.join('/') || '/';
  return (out.startsWith('/') ? out : `/${out}`).slice(0, TRACK_LIMITS.path);
}

// ───────── Channel classification (docs/07 "Channel rules", first match wins) ─────────

export const SEARCH_ENGINE_HOSTS = [
  'google.',
  'bing.com',
  'yandex.',
  'ya.ru',
  'duckduckgo.com',
  'search.yahoo.',
  'yahoo.com',
  'baidu.com',
  'ecosia.org',
  'search.brave.com',
  'mail.ru',
  'rambler.ru',
] as const;

export const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'l.instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'vk.com',
  'ok.ru',
  'x.com',
  'twitter.com',
  't.co',
  'linkedin.com',
  'pinterest.',
  'threads.net',
] as const;

export const TELEGRAM_HOSTS = ['t.me', 'telegram.me', 'telegram.org', 'web.telegram.org'] as const;

const PAID_MEDIUM = /^(cpc|ppc|cpm|paid|paid[_-].+|.+[_-]paid|display|ads?)$/;
const CLICK_ID_PLATFORM: Record<ClickIdKey, string> = {
  gclid: 'google',
  fbclid: 'meta',
  ttclid: 'tiktok',
  yclid: 'yandex',
};
const SOURCE_ALIASES: Record<string, string> = {
  fb: 'meta',
  facebook: 'meta',
  instagram: 'meta',
  ig: 'meta',
  meta: 'meta',
  google: 'google',
  adwords: 'google',
  youtube: 'google',
  tiktok: 'tiktok',
  yandex: 'yandex',
  'yandex.direct': 'yandex',
  direct: 'yandex',
  telegram: 'telegram',
  tg: 'telegram',
  't.me': 'telegram',
};

export interface ChannelInput {
  utm?: Utm | null;
  clickIds?: ClickIds | null;
  /** Document referrer (full URL or host). */
  referrer?: string | null;
  /** Our own hosts: a referrer from these counts as none (internal navigation). */
  ownHosts?: readonly string[];
}

export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer.includes('://') ? referrer : `https://${referrer}`);
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

const hostMatches = (host: string, list: readonly string[]) =>
  list.some((h) =>
    h.endsWith('.')
      ? host.startsWith(h) || host.includes(`.${h}`)
      : host === h || host.endsWith(`.${h}`),
  );

const norm = (v: string | undefined | null) => (v ?? '').trim().toLowerCase();

/** Platform key for a paid touch: click id platform first, else the normalised utm_source. */
export function paidPlatform(utm: Utm | null | undefined, clickIds: ClickIds | null | undefined) {
  for (const k of CLICK_ID_KEYS) if (clickIds?.[k]) return CLICK_ID_PLATFORM[k];
  const src = norm(utm?.source);
  const alias = SOURCE_ALIASES[src];
  if (alias) return alias;
  return (
    src
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'other'
  );
}

export type Channel =
  | `paid_${string}`
  | 'telegram'
  | 'organic_search'
  | 'organic_social'
  | 'sms'
  | 'bot'
  | 'email'
  | 'referral'
  | 'direct';

export function classifyChannel(input: ChannelInput): Channel {
  const utm = input.utm ?? {};
  const source = norm(utm.source);
  const medium = norm(utm.medium);
  let host = referrerHost(input.referrer);
  if (host && input.ownHosts?.some((h) => host === h.toLowerCase().replace(/^www\./, '')))
    host = null;

  const hasClickId = CLICK_ID_KEYS.some((k) => Boolean(input.clickIds?.[k]));
  if (hasClickId || PAID_MEDIUM.test(medium)) return `paid_${paidPlatform(utm, input.clickIds)}`;
  if (source === 'telegram' || source === 't.me' || source === 'tg') return 'telegram';
  if (host && hostMatches(host, TELEGRAM_HOSTS)) return 'telegram';
  if (host && hostMatches(host, SEARCH_ENGINE_HOSTS)) return 'organic_search';
  if (host && hostMatches(host, SOCIAL_HOSTS)) return 'organic_social';
  if (medium === 'sms') return 'sms';
  if (source === 'bot' || medium === 'bot') return 'bot';
  if (medium === 'email' || medium === 'e-mail' || medium === 'newsletter') return 'email';
  if (host || source) return 'referral';
  return 'direct';
}
