import { Injectable, Logger } from '@nestjs/common';
import {
  fillTemplate,
  formatSoum,
  formatTashkentHm,
  type Locale,
  maskUzPhone,
  t,
} from '@forest/contracts';
import { GrammyError } from 'grammy';
import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from 'grammy/types';
import { FilesService } from '../files/files.service';
import type { MessengerButton } from '../integrations/providers/types';
import {
  MARKETING_STOP_CALLBACK,
  reviewStarCallback,
  type TelegramOutbound,
  type TelegramSender,
} from '../messaging/telegram-sender';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { copy, html } from './bot-copy';
import { TelegramGateway } from './telegram-gateway.service';

export type BotUnreachableReason = 'blocked' | 'no_chat' | 'not_configured' | 'scenario_off';

/** The chat can't get this message; the messaging dispatcher falls back to SMS. */
export class BotUnreachableError extends Error {
  constructor(
    readonly reason: BotUnreachableReason,
    detail = '',
  ) {
    super(`telegram ${reason}${detail ? `: ${detail}` : ''}`);
  }
}

/** An inline button of ours: URL, callback or Telegram's copy-to-clipboard (`copy_text`). */
export type BotButton =
  | { text: string; url: string }
  | { text: string; callback: string }
  | { text: string; copy: string };

export type BotMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

export interface BotSendInput {
  /** HTML (escape user/template text with `html()`). */
  text: string;
  inline?: BotButton[][];
  /** Reply keyboard (request_contact etc.) instead of inline buttons. */
  markup?: BotMarkup;
  photoUrl?: string | null;
}

export interface BotRecord {
  customerId: string | null;
  templateKey?: string | null;
  marketing?: boolean;
}

const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;

export function inlineKeyboard(rows: BotButton[][]): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows
      .filter((r) => r.length)
      .map((r) =>
        r.map((b): InlineKeyboardButton => {
          if ('url' in b) return { text: b.text, url: b.url };
          if ('copy' in b) return { text: b.text, copy_text: { text: b.copy } };
          return { text: b.text, callback_data: b.callback };
        }),
      ),
  };
}

/** Messaging's provider-neutral buttons → ours (unknown shapes dropped). */
function fromMessenger(rows: MessengerButton[][] | undefined): BotButton[][] {
  return (rows ?? []).map((r) =>
    r.flatMap((b): BotButton[] =>
      b.url
        ? [{ text: b.text, url: b.url }]
        : b.callbackData
          ? [{ text: b.text, callback: b.callbackData }]
          : [],
    ),
  );
}

/**
 * The bot's outbound side (CLAUDE.md §6, 5A): every Telegram message leaves through `send()`,
 * which maps "blocked by the user" / "chat not found" to `BotUnreachableError` and marks the
 * subscriber. Implements messaging's `TelegramSender` (5B's dispatcher) with flow-specific
 * rendering, and renders + records the bot's own template replies.
 */
@Injectable()
export class BotService implements TelegramSender {
  private readonly logger = new Logger('Bot');

  constructor(
    private readonly gateway: TelegramGateway,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  /** Low-level send; returns Telegram's message id. */
  async send(chatId: bigint | number | string, input: BotSendInput): Promise<number> {
    const ctx = await this.gateway.api();
    if (!ctx) throw new BotUnreachableError('not_configured');
    const markup =
      input.markup ?? (input.inline?.length ? inlineKeyboard(input.inline) : undefined);
    const chat = String(chatId);
    try {
      if (input.photoUrl) {
        const caption =
          input.text.length > CAPTION_MAX ? input.text.slice(0, CAPTION_MAX) : input.text;
        const m = await ctx.api.sendPhoto(chat, input.photoUrl, {
          caption,
          parse_mode: 'HTML',
          ...(markup ? { reply_markup: markup } : {}),
        });
        return m.message_id;
      }
      const m = await ctx.api.sendMessage(chat, input.text.slice(0, TEXT_MAX), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup } : {}),
      });
      return m.message_id;
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) {
        await this.markBlocked(chat);
        throw new BotUnreachableError('blocked', e.description);
      }
      if (e instanceof GrammyError && /chat not found/i.test(e.description))
        throw new BotUnreachableError('no_chat', e.description);
      throw e;
    }
  }

  /** Sends and stores a `Message` row (TELEGRAM) for the customer's history and A12 metrics. */
  async sendRecorded(
    chatId: bigint | number | string,
    input: BotSendInput,
    record: BotRecord,
  ): Promise<number | null> {
    try {
      const id = await this.send(chatId, input);
      await this.prisma.message.create({
        data: {
          customerId: record.customerId,
          channel: 'TELEGRAM',
          templateKey: record.templateKey ?? null,
          body: stripHtml(input.text),
          status: 'SENT',
          marketing: record.marketing ?? false,
          kind: record.marketing ? 'marketing' : 'service',
          providerId: String(id),
          sentAt: new Date(),
        },
      });
      return id;
    } catch (e) {
      this.logger.warn(`bot send ${record.templateKey ?? 'reply'} failed: ${String(e)}`);
      return null;
    }
  }

  /**
   * A12 template rendered for the chat's language (null when the template is missing/inactive
   * or a variable is missing — the flow then falls back to its copy text).
   */
  async template(
    key: string,
    locale: Locale,
    vars: Record<string, string | number>,
  ): Promise<{ text: string; buttons: BotButton[][] } | null> {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { key } });
    if (!tpl?.active) {
      this.logger.warn(`message template "${key}" is missing or inactive`);
      return null;
    }
    const text = fillTemplate(t(tpl.body, locale), vars);
    if (text === null) return null;
    const buttons = Array.isArray(tpl.buttons)
      ? (tpl.buttons as { text?: unknown; url?: unknown }[]).flatMap((b): BotButton[] => {
          const url = typeof b.url === 'string' ? fillTemplate(b.url, vars) : null;
          const label = t(b.text, locale);
          return url && /^https?:\/\//.test(url) && label ? [{ text: label, url }] : [];
        })
      : [];
    return { text, buttons: buttons.length ? [buttons] : [] };
  }

  // ───────── messaging's TelegramSender (5B dispatcher) ─────────

  async sendMessage(input: TelegramOutbound): Promise<{ messageId: string }> {
    if (!/^-?\d{1,20}$/.test(input.chatId)) throw new BotUnreachableError('no_chat');
    const sub = await this.prisma.botSubscriber.findUnique({
      where: { telegramId: BigInt(input.chatId) },
      select: { blockedAt: true, locale: true, customerId: true },
    });
    if (sub?.blockedAt) throw new BotUnreachableError('blocked');
    let text = html(input.text);
    let inline = fromMessenger(input.buttons);
    let photoUrl = input.photoUrl ?? null;
    const flow = input.flow;
    const locale = await this.chatLocale(input.chatId, sub?.locale ?? null);
    if (flow?.kind === 'order') {
      const rules = await this.settings.get('bot.rules');
      if (!rules.scenarios.orderStatus) throw new BotUnreachableError('scenario_off');
      text = await this.orderDetails(flow.orderId, flow.templateKey, text, locale);
    } else if (flow?.kind === 'abandoned_cart') {
      const extra = await this.cartDetails(flow.cartId, locale);
      text = extra.text ? `${text}\n\n${extra.text}` : text;
      photoUrl = photoUrl ?? extra.photoUrl;
      inline = withCartButtons(inline, locale);
    } else if (flow?.kind === 'review_request') {
      const hasStars = inline.some((r) =>
        r.some((b) => 'callback' in b && b.callback.startsWith('rv:')),
      );
      if (!hasStars)
        inline = [
          [1, 2, 3, 4, 5].map((n) => ({
            text: `${n} ★`,
            callback: reviewStarCallback(flow.orderId, n),
          })),
          ...inline,
        ];
    }
    const id = await this.send(input.chatId, { text, inline, photoUrl });
    return { messageId: String(id) };
  }

  /** Language of a chat: explicit `/til`, else the linked customer's, else uz. */
  private async chatLocale(chatId: string, explicit: Locale | null): Promise<Locale> {
    if (explicit) return explicit;
    const c = await this.prisma.customer.findUnique({
      where: { telegramId: BigInt(chatId) },
      select: { locale: true },
    });
    return c?.locale ?? 'uz';
  }

  /** Items + total (accepted) or courier name, masked phone and ETA (courier on the way). */
  private async orderDetails(
    orderId: string,
    templateKey: string,
    text: string,
    locale: Locale,
  ): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) return text;
    const lines: string[] = [];
    if (templateKey === 'order_created' || templateKey === 'order_phone_created') {
      lines.push(`<b>${html(copy(locale, 'orderTitle', { raqam: order.number }))}</b>`);
      for (const i of order.items.slice(0, 10)) {
        const snap = i.nameSnapshot as { product?: unknown; variant?: unknown };
        const variant = t(snap.variant, locale);
        lines.push(html(`${t(snap.product, locale)}${variant ? `, ${variant}` : ''} × ${i.qty}`));
      }
      lines.push(
        `${html(copy(locale, 'orderTotal'))}: <b>${html(formatSoum(order.totalTiyin, locale))}</b>`,
      );
    }
    if (templateKey === 'order_courier') {
      const c = order.shipments[0]?.courier as
        { name?: string; phone?: string | null; etaAt?: string | null } | null | undefined;
      if (c?.name) {
        const phone = c.phone ? ` · ${maskUzPhone(c.phone)}` : '';
        lines.push(html(`${copy(locale, 'courier')}: ${c.name.split(' ')[0]}${phone}`));
      }
      if (c?.etaAt)
        lines.push(html(copy(locale, 'eta', { vaqt: formatTashkentHm(new Date(c.etaAt)) })));
    }
    return lines.length ? `${text}\n\n${lines.join('\n')}` : text;
  }

  /** Product photo + "N items · total" for the abandoned-cart reminder. */
  private async cartDetails(
    cartId: string,
    locale: Locale,
  ): Promise<{ text: string; photoUrl: string | null }> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          orderBy: { addedAt: 'asc' },
          include: {
            variant: {
              include: {
                product: {
                  include: {
                    images: { include: { file: true }, orderBy: { sort: 'asc' }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cart?.items.length) return { text: '', photoUrl: null };
    const qty = cart.items.reduce((s, i) => s + i.qty, 0);
    const sum = cart.items.reduce((s, i) => s + i.variant.priceTiyin * BigInt(i.qty), 0n);
    const file = cart.items[0]!.variant.product.images[0]?.file;
    return {
      text: [
        html(copy(locale, 'cartSummary', { n: qty, sum: formatSoum(sum, locale) })),
        html(copy(locale, 'cartDelivery')),
      ].join('\n'),
      photoUrl: file?.isPublic ? this.files.publicUrl(file.key) : null,
    };
  }

  async markBlocked(chatId: string): Promise<void> {
    if (!/^-?\d{1,20}$/.test(chatId)) return;
    await this.prisma.botSubscriber
      .updateMany({
        where: { telegramId: BigInt(chatId), blockedAt: null },
        data: { blockedAt: new Date() },
      })
      .catch((e: unknown) => this.logger.warn(`mark blocked failed: ${String(e)}`));
  }
}

/** "Savolim bor" next to the opt-out (docs/09 flow 3); the opt-out is added when missing. */
function withCartButtons(rows: BotButton[][], locale: Locale): BotButton[][] {
  const flat = rows.flat();
  const hasStop = flat.some((b) => 'callback' in b && b.callback === MARKETING_STOP_CALLBACK);
  const others = rows
    .map((r) => r.filter((b) => !('callback' in b && b.callback === MARKETING_STOP_CALLBACK)))
    .filter((r) => r.length);
  const stop = hasStop
    ? flat.find((b) => 'callback' in b && b.callback === MARKETING_STOP_CALLBACK)!
    : { text: copy(locale, 'stopButton'), callback: MARKETING_STOP_CALLBACK };
  return [...others, [{ text: copy(locale, 'cartQuestion'), callback: 'ask:cart' }, stop]];
}

export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
