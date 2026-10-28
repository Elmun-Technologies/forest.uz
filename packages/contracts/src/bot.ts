/**
 * Telegram service bot (docs/09, A12, CLAUDE.md §6 "Telegram bot"). Zod-free: pure rules shared by
 * the API (bot handlers, admin) and the admin UI; admin inputs live in `schemas/admin-bot.ts`.
 */
import type { Locale } from './locale';
import { normalizeSearch } from './text';
import { parseHm, toTashkentParts } from './time';

/** Default complaint keywords (`bot.rules.complaintKeywords`); matched after `normalizeSearch`. */
export const BOT_COMPLAINT_KEYWORDS: string[] = [
  'shikoyat',
  'norozi',
  'yomon',
  'sifatsiz',
  'buzilgan',
  'qaytar',
  'pulimni',
  'aldad',
  'жалоб',
  'плох',
  'брак',
  'обман',
  'верните',
  'ужас',
];

/**
 * True when `text` contains a complaint keyword. Both sides go through `normalizeSearch`
 * (Cyrillic → Latin, apostrophe variants removed), so "жалоба", "Shikoyat" and "qaytarib
 * bering" match their keywords; matching is by word prefix (Uzbek suffixes, Russian endings).
 */
export function matchesComplaint(text: string, keywords: readonly string[]): boolean {
  const words = normalizeSearch(text).split(' ').filter(Boolean);
  if (!words.length) return false;
  return keywords.some((k) => {
    const key = normalizeSearch(k);
    if (key.length < 2) return false;
    if (key.includes(' ')) return ` ${words.join(' ')} `.includes(` ${key}`);
    return words.some((w) => w.startsWith(key));
  });
}

export interface OperatorHours {
  /** 0 = Sunday … 6 = Saturday (Tashkent). */
  operatorDays: readonly number[];
  operatorStart: string;
  operatorEnd: string;
}

/** Operators answer on the listed Tashkent weekdays within [start, end). */
export function isOperatorHours(rules: OperatorHours, at: Date): boolean {
  const p = toTashkentParts(at);
  if (!rules.operatorDays.includes(p.weekday)) return false;
  const minute = p.hour * 60 + p.minute;
  const start = parseHm(rules.operatorStart);
  const end = parseHm(rules.operatorEnd);
  return end > start ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Bot language (docs/09): the explicit `/til` choice, else the customer's site locale, else
 * Telegram `language_code` (ru → ru, anything else → uz), limited to the enabled languages.
 */
export function botLocale(input: {
  explicit?: Locale | null;
  customer?: Locale | null;
  languageCode?: string | null;
  enabled?: readonly Locale[];
}): Locale {
  const enabled = input.enabled?.length ? input.enabled : (['uz', 'ru'] as const);
  const wanted =
    input.explicit ??
    input.customer ??
    (input.languageCode?.toLowerCase().startsWith('ru') ? 'ru' : 'uz');
  return enabled.includes(wanted) ? wanted : (enabled[0] ?? 'uz');
}

/** A12 scenarios table rows (docs/09 flows 1–5). */
export const BOT_SCENARIOS = ['lead', 'orderStatus', 'abandonedCart', 'advice', 'review'] as const;
export type BotScenario = (typeof BOT_SCENARIOS)[number];

export const BOT_CONVERSATION_STATUSES = [
  'NEW',
  'OPEN',
  'ANSWERED',
  'COMPLAINT',
  'CLOSED',
] as const;
export type BotConversationStatus = (typeof BOT_CONVERSATION_STATUSES)[number];
export const BOT_CONVERSATION_TOPICS = ['advice', 'cart', 'status', 'review', 'other'] as const;
export type BotConversationTopic = (typeof BOT_CONVERSATION_TOPICS)[number];

/** Limits shared by the inbox UI and the API. */
export const BOT_LIMITS = {
  replyMax: 2000,
  /** Photos accepted per review. */
  reviewPhotos: 5,
  photoMaxBytes: 10 * 1024 * 1024,
  /** The advice auto-reply is sent at most once per this window per chat. */
  autoReplyMinutes: 30,
} as const;

// ───────────────────────── Admin DTOs ─────────────────────────

export interface AdminBotKpisDto {
  subscribers: number;
  subscribersNew30d: number;
  phones: number;
  /** % of subscribers who shared a phone (null when there are none). */
  phonesPct: number | null;
  botOrders30d: number;
  botRevenueSoum30d: number;
  /** Stops + blocks in 30 days / subscribers, % (null when there are none). */
  unsubscribeRatePct: number | null;
}

export interface AdminBotScenarioDto {
  key: BotScenario;
  enabled: boolean;
  /** Messages the bot sent for this flow in 30 days. */
  sent30d: number;
  /** Result count in 30 days (meaning per row: leads, orders, reviews…); null = not measurable. */
  result30d: number | null;
  resultKind: 'leads' | 'orders' | 'reviews' | null;
}

export interface AdminBotOverviewDto {
  botUsername: string | null;
  connected: boolean;
  kpis: AdminBotKpisDto;
  scenarios: AdminBotScenarioDto[];
  complaintKeywords: string[];
  settings: {
    operatorDays: number[];
    operatorStart: string;
    operatorEnd: string;
    marketingPerDay: number;
    languages: Locale[];
    operators: { id: string; name: string }[];
    /** Masked bot token (last 4) from the integrations hub; null when not connected. */
    tokenMasked: string | null;
    adminGroup: boolean;
  };
  /** Setting version for the rules editor (`SETTINGS_CONFLICT`). */
  version: string | null;
}

export interface AdminBotConversationRowDto {
  id: string;
  status: BotConversationStatus;
  topic: BotConversationTopic;
  /** First name + initial ("Dilnoza Y."), else the Telegram first name, else "Mijoz". */
  title: string;
  initials: string;
  preview: string;
  hasPhoto: boolean;
  lastMessageAt: string;
  customer: { id: string; publicId: string } | null;
  assignee: { id: string; name: string } | null;
}

export interface AdminBotConversationListDto {
  items: AdminBotConversationRowDto[];
  nextCursor: string | null;
  counts: Record<'all' | BotConversationStatus, number>;
}

export interface AdminBotMessageDto {
  id: string;
  fromCustomer: boolean;
  staffName: string | null;
  text: string | null;
  photos: { fileId: string; url: string }[];
  product: { name: string; priceSoum: number | null } | null;
  createdAt: string;
}

export interface AdminBotConversationDto extends AdminBotConversationRowDto {
  messages: AdminBotMessageDto[];
  operators: { id: string; name: string }[];
  /** Replies are possible while the bot can reach the chat. */
  canReply: boolean;
}
