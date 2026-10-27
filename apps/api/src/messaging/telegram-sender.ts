import type { MessengerButton } from '../integrations/providers/types';

/**
 * Flow context the bot (Phase 5A `BotService`) uses to enrich a message: abandoned cart → product
 * photo + items/total; review request → the 1–5★ row `rv:<orderId>:<n>`; order → items/courier.
 */
export type TelegramFlow =
  | { kind: 'abandoned_cart'; cartId: string }
  | { kind: 'review_request'; orderId: string }
  | { kind: 'order'; orderId: string; templateKey: string };

export interface TelegramOutbound {
  chatId: string;
  text: string;
  buttons?: MessengerButton[][];
  photoUrl?: string;
  flow?: TelegramFlow;
}

/**
 * The only way messaging reaches Telegram (CLAUDE.md §6). Same shape as `MessengerProvider`;
 * the bot's `BotService` implements it and throws (e.g. `BotUnreachableError` blocked/no_chat/
 * scenario_off) when the chat can't get the message — the dispatcher then falls back to SMS for
 * service messages.
 */
export interface TelegramSender {
  sendMessage(input: TelegramOutbound): Promise<{ messageId: string }>;
}

export const TELEGRAM_SENDER = Symbol('TELEGRAM_SENDER');

/** Callback data the bot handles (docs/09): marketing opt-out and review stars. */
export const MARKETING_STOP_CALLBACK = 'mk:stop';
export const reviewStarCallback = (orderId: string, stars: number) => `rv:${orderId}:${stars}`;
