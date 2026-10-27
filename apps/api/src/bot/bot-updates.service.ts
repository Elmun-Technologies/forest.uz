import { Injectable, Logger } from '@nestjs/common';
import { type BotConversationTopic, formatSoum, type Locale } from '@forest/contracts';
import type { BotSubscriber, Customer } from '@forest/db';
import { Bot, type Context, session, type SessionFlavor } from 'grammy';
import type { Update } from 'grammy/types';
import { LEAD_PROMO_CODE } from '../customer/leads/leads.service';
import { FilesService } from '../files/files.service';
import { MARKETING_STOP_CALLBACK } from '../messaging/telegram-sender';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { BOT_ORDER_STATUS, copy, html, isCopyLabel } from './bot-copy';
import { BotInboxService } from './bot-inbox.service';
import { BotReviewsService } from './bot-reviews.service';
import { type BotSession, redisSessionStorage } from './bot-session';
import { type BotUser, BotSubscribersService } from './bot-subscribers.service';
import { type BotMarkup, BotService } from './bot.service';
import { publishReviewPhotos } from './review-photos';
import { StartLinksService } from './start-links.service';
import { type BotConfig, TelegramGateway } from './telegram-gateway.service';

interface Forest {
  sub: BotSubscriber;
  customer: Customer | null;
  locale: Locale;
}

type Ctx = Context & SessionFlavor<BotSession> & { forest: Forest };

const RAHMAT_CODE = 'RAHMAT5';
const DUPLICATE_TTL_SEC = 24 * 3600;
/** Weekday abbreviations by JS weekday (0 = Sunday). */
const DAY_NAMES: Record<Locale, readonly string[]> = {
  uz: ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
};

/**
 * Inbound side of the bot (docs/09 flows 1, 4, 5 + commands): one grammY `Bot` per token routes
 * webhook updates. Replies leave through `BotService` (logged as `Message` rows). Errors are
 * logged and swallowed — Telegram must always get 200 or it retries the update.
 */
@Injectable()
export class BotUpdatesService {
  private readonly logger = new Logger('BotUpdates');
  private readonly bots = new Map<string, Bot<Ctx>>();

  constructor(
    private readonly gateway: TelegramGateway,
    private readonly bot: BotService,
    private readonly subscribers: BotSubscribersService,
    private readonly inbox: BotInboxService,
    private readonly reviews: BotReviewsService,
    private readonly starts: StartLinksService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  /** Handles one update once (Telegram redelivers on timeouts: `update_id` dedupe). */
  async handle(config: BotConfig, update: Update): Promise<void> {
    const fresh = await this.redis.set(
      `tg:upd:${config.token.split(':')[0]}:${update.update_id}`,
      '1',
      'EX',
      DUPLICATE_TTL_SEC,
      'NX',
    );
    if (fresh !== 'OK') return;
    try {
      await this.botFor(config).handleUpdate(update);
    } catch (e) {
      this.logger.error(
        `update ${update.update_id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private botFor(config: BotConfig): Bot<Ctx> {
    let b = this.bots.get(config.token);
    if (!b) {
      b = this.build(config);
      this.bots.set(config.token, b);
    }
    return b;
  }

  private build(config: BotConfig): Bot<Ctx> {
    const b = new Bot<Ctx>(config.token, { botInfo: this.gateway.botInfo(config) });
    this.gateway.install(b.api, config);

    b.on('my_chat_member', async (ctx) => {
      const status = ctx.myChatMember.new_chat_member.status;
      if (ctx.chat.type !== 'private') return;
      if (status === 'kicked') await this.subscribers.blocked(ctx.chat.id);
      else if (ctx.from) await this.subscribers.touch(ctx.from as BotUser);
    });

    // Private chats only (the admin alerts group is write-only for the bot).
    b.use(async (ctx, next) => {
      if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
      const sub = await this.subscribers.touch(ctx.from as BotUser);
      const customer = await this.subscribers.customer(ctx.from.id);
      ctx.forest = { sub, customer, locale: await this.subscribers.locale(sub, customer) };
      await next();
    });
    b.use(
      session<BotSession, Ctx>({
        initial: () => ({}),
        storage: redisSessionStorage(this.redis),
        getSessionKey: (ctx) => (ctx.chat ? String(ctx.chat.id) : undefined),
      }),
    );

    b.command('start', (ctx) => this.start(ctx, String(ctx.match ?? '')));
    b.command('buyurtmalar', (ctx) => this.orders(ctx));
    b.command('yordam', (ctx) => this.help(ctx));
    b.command('til', (ctx) => this.languagePrompt(ctx));
    b.command('stop', (ctx) => this.stop(ctx));
    b.on('message:contact', (ctx) => this.contact(ctx));
    b.on('callback_query:data', (ctx) => this.callback(ctx));
    b.on('message:photo', (ctx) => this.photo(ctx));
    b.on('message:text', (ctx) => this.text(ctx));
    b.on('message', (ctx) => this.other(ctx));
    return b;
  }

  // ───────── helpers ─────────

  private chat(ctx: Ctx): bigint {
    return BigInt(ctx.chat!.id);
  }

  private say(ctx: Ctx, text: string, extra: { markup?: BotMarkup; key?: string } = {}) {
    return this.bot.sendRecorded(
      this.chat(ctx),
      { text, ...(extra.markup ? { markup: extra.markup } : {}) },
      { customerId: ctx.forest.customer?.id ?? null, templateKey: extra.key ?? null },
    );
  }

  /** Reply keyboard: share phone (until linked) + advice + delivery. */
  private keyboard(locale: Locale, withPhone: boolean): BotMarkup {
    return {
      keyboard: [
        ...(withPhone ? [[{ text: copy(locale, 'shareButton'), request_contact: true }]] : []),
        [{ text: copy(locale, 'adviceButton') }, { text: copy(locale, 'deliveryButton') }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  private site(locale: Locale, path: string, campaign: string): string {
    return this.gateway.siteUrl(`/${locale}${path}`, campaign);
  }

  // ───────── /start (flow 1) ─────────

  private async start(ctx: Ctx, payload: string): Promise<void> {
    const { sub, locale } = ctx.forest;
    const ref = await this.starts.resolve(payload);
    const { resubscribed } = await this.subscribers.start(sub, ref);
    const customer = ctx.forest.customer;
    if (resubscribed) await this.say(ctx, html(copy(locale, 'resubscribed')));
    if (ref.orderToken) return this.orderSummary(ctx, ref.orderToken);

    const rules = await this.settings.get('bot.rules');
    const hasOrders = customer
      ? (await this.prisma.order.count({ where: { customerId: customer.id } })) > 0
      : false;
    const tpl =
      rules.scenarios.lead && !hasOrders
        ? await this.bot.template('lead_welcome', locale, {
            ism: ctx.from!.first_name,
            kod: LEAD_PROMO_CODE,
            link: this.site(locale, '/katalog', 'lead'),
          })
        : null;
    if (tpl) {
      const media = await this.settings.get('home.media').catch(() => null);
      await this.bot.sendRecorded(
        this.chat(ctx),
        {
          text: html(tpl.text).replace(LEAD_PROMO_CODE, `<code>${LEAD_PROMO_CODE}</code>`),
          inline: [
            [{ text: copy(locale, 'copyCode'), copy: LEAD_PROMO_CODE }, ...(tpl.buttons[0] ?? [])],
          ],
          photoUrl: media?.leadImage ? this.files.publicUrl(media.leadImage.key) : null,
        },
        { customerId: customer?.id ?? null, templateKey: 'lead_welcome' },
      );
    } else {
      await this.say(ctx, html(copy(locale, 'welcome')));
    }
    await this.say(ctx, html(copy(locale, customer?.phone ? 'advicePrompt' : 'sharePhone')), {
      markup: this.keyboard(locale, !customer?.phone),
    });
  }

  /** Signed `o` payload: the order's status + tracking link (no account link). */
  private async orderSummary(ctx: Ctx, token: string): Promise<void> {
    const { locale, customer } = ctx.forest;
    const order = await this.prisma.order.findUnique({
      where: { trackingToken: token },
      select: { number: true, status: true, totalTiyin: true },
    });
    if (!order) {
      await this.say(ctx, html(copy(locale, 'welcome')));
    } else {
      await this.bot.sendRecorded(
        this.chat(ctx),
        {
          text: [
            `<b>${html(copy(locale, 'orderTitle', { raqam: order.number }))}</b>`,
            html(
              `${BOT_ORDER_STATUS[locale][order.status] ?? order.status} · ${formatSoum(order.totalTiyin, locale)}`,
            ),
          ].join('\n'),
          inline: [[{ text: copy(locale, 'track'), url: this.trackUrl(token) }]],
        },
        { customerId: customer?.id ?? null },
      );
    }
    if (!customer?.phone)
      await this.say(ctx, html(copy(locale, 'sharePhone')), {
        markup: this.keyboard(locale, true),
      });
  }

  // ───────── contact (flow 1) ─────────

  private async contact(ctx: Ctx): Promise<void> {
    const contact = ctx.message!.contact!;
    const { locale } = ctx.forest;
    const rules = await this.settings.get('bot.rules');
    const r = await this.subscribers.linkContact(ctx.from as BotUser, contact, {
      locale,
      leadOn: rules.scenarios.lead,
    });
    if (!r.ok) {
      const key =
        r.reason === 'not_own'
          ? 'contactNotOwn'
          : r.reason === 'invalid'
            ? 'contactInvalid'
            : 'contactConflict';
      await this.say(ctx, html(copy(locale, key)), {
        markup: this.keyboard(locale, r.reason === 'not_own'),
      });
      return;
    }
    const customer = await this.subscribers.customer(ctx.from!.id);
    ctx.forest.customer = customer;
    await this.say(ctx, html(copy(locale, 'phoneThanks')), {
      markup: this.keyboard(locale, false),
    });
  }

  // ───────── commands ─────────

  private async orders(ctx: Ctx): Promise<void> {
    const { customer, locale } = ctx.forest;
    if (!customer?.phone) {
      await this.say(ctx, html(copy(locale, 'ordersNeedPhone')), {
        markup: this.keyboard(locale, true),
      });
      return;
    }
    const orders = await this.prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { number: true, status: true, totalTiyin: true, trackingToken: true },
    });
    if (!orders.length) {
      await this.say(ctx, html(copy(locale, 'ordersEmpty')));
      return;
    }
    await this.bot.sendRecorded(
      this.chat(ctx),
      {
        text: [
          `<b>${html(copy(locale, 'ordersHeader'))}</b>`,
          ...orders.map((o) =>
            html(
              `${o.number} · ${BOT_ORDER_STATUS[locale][o.status] ?? o.status} · ${formatSoum(o.totalTiyin, locale)}`,
            ),
          ),
        ].join('\n'),
        inline: orders.map((o) => [
          { text: `${o.number} — ${copy(locale, 'track')}`, url: this.trackUrl(o.trackingToken) },
        ]),
      },
      { customerId: customer.id },
    );
  }

  private trackUrl(token: string): string {
    return this.gateway.siteUrl(`/t/${token}`, 'order');
  }

  private async help(ctx: Ctx): Promise<void> {
    const { locale } = ctx.forest;
    const rules = await this.settings.get('messaging.rules');
    ctx.session.ask = 'other';
    const hours = `${copy(locale, 'hours')}: ${dayRange(rules.operatorDays, locale)} ${rules.operatorStart}–${rules.operatorEnd}`;
    await this.say(ctx, html(`${copy(locale, 'help')}\n${hours}`));
  }

  private async languagePrompt(ctx: Ctx): Promise<void> {
    await this.bot.sendRecorded(
      this.chat(ctx),
      {
        text: html(copy(ctx.forest.locale, 'langPrompt')),
        inline: [
          [
            { text: "O'zbekcha", callback: 'lang:uz' },
            { text: 'Русский', callback: 'lang:ru' },
          ],
        ],
      },
      { customerId: ctx.forest.customer?.id ?? null },
    );
  }

  private async stop(ctx: Ctx): Promise<void> {
    await this.subscribers.stop(ctx.from!.id);
    await this.say(ctx, html(copy(ctx.forest.locale, 'stopDone')));
  }

  // ───────── callbacks ─────────

  private async callback(ctx: Ctx): Promise<void> {
    const data = ctx.callbackQuery!.data!;
    await ctx.answerCallbackQuery().catch(() => undefined);
    const { locale, customer } = ctx.forest;
    if (data === MARKETING_STOP_CALLBACK) return this.stop(ctx);
    if (data === 'ask:cart') {
      ctx.session.ask = 'cart';
      await this.say(ctx, html(copy(locale, 'cartAsk')));
      return;
    }
    if (data === 'lang:uz' || data === 'lang:ru') {
      const next = data.slice(5) as Locale;
      await this.subscribers.setLocale(ctx.from!.id, next);
      ctx.forest.locale = next;
      await this.say(ctx, html(copy(next, 'langSet')), {
        markup: this.keyboard(next, !customer?.phone),
      });
      return;
    }
    const rv = /^rv:([\w-]{1,40}):([1-5])$/.exec(data);
    if (rv) return this.rate(ctx, rv[1]!, Number(rv[2]));
    const rc = /^rc:([\w-]{1,40}):([01])$/.exec(data);
    if (rc) return this.consent(ctx, rc[1]!, rc[2] === '1');
  }

  /** Flow 5: stars. */
  private async rate(ctx: Ctx, orderId: string, stars: number): Promise<void> {
    const { locale, customer } = ctx.forest;
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    const r = await this.reviews.rate(this.chat(ctx), customer?.id ?? null, orderId, stars, locale);
    if (r.kind === 'stale' || r.kind === 'already') {
      await this.say(ctx, html(copy(locale, r.kind === 'stale' ? 'reviewStale' : 'reviewAlready')));
      return;
    }
    const vars = { ism: ctx.from!.first_name };
    if (r.kind === 'low') {
      ctx.session.review = undefined;
      const tpl = await this.bot.template('review_low_apology', locale, vars);
      if (tpl) await this.say(ctx, html(tpl.text), { key: 'review_low_apology' });
      return;
    }
    ctx.session.review = { reviewId: r.reviewId, stage: 'photo', codeSent: false };
    const tpl = await this.bot.template('review_thanks_high', locale, vars);
    if (tpl) await this.say(ctx, html(tpl.text), { key: 'review_thanks_high' });
  }

  private async consent(ctx: Ctx, reviewId: string, yes: boolean): Promise<void> {
    const { locale, customer } = ctx.forest;
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    const review = await this.reviews.own(reviewId, customer?.id ?? null);
    if (!review) {
      await this.say(ctx, html(copy(locale, 'reviewStale')));
      return;
    }
    await this.reviews.setConsent(reviewId, yes);
    // Consent after a moderator already approved: publish now (else on approval).
    if (yes) await publishReviewPhotos(this.prisma, this.files, reviewId, this.logger);
    ctx.session.review = undefined;
    await this.say(ctx, html(copy(locale, yes ? 'reviewConsentYes' : 'reviewConsentNo')));
  }

  // ───────── messages ─────────

  private async photo(ctx: Ctx): Promise<void> {
    const { locale, customer } = ctx.forest;
    const sizes = ctx.message!.photo!;
    const largest = sizes[sizes.length - 1]!;
    const flow = ctx.session.review;
    if (flow && customer) {
      const review = await this.reviews.own(flow.reviewId, customer.id);
      if (review) {
        const fileId = await this.inbox.storePhoto(largest.file_id, `reviews/${review.id}`);
        if (!fileId) {
          await this.say(ctx, html(copy(locale, 'photoFailed')));
          return;
        }
        const count = await this.reviews.addPhoto(review.id, fileId);
        if (ctx.message!.caption) await this.reviews.setTextOnce(review.id, ctx.message!.caption);
        if (count !== null && !flow.codeSent) {
          flow.codeSent = true;
          flow.stage = 'consent';
          const tpl = await this.bot.template('review_photo_code', locale, {
            ism: ctx.from!.first_name,
            kod: RAHMAT_CODE,
          });
          if (tpl)
            await this.bot.sendRecorded(
              this.chat(ctx),
              {
                text: html(tpl.text).replace(RAHMAT_CODE, `<code>${RAHMAT_CODE}</code>`),
                inline: [
                  [
                    { text: copy(locale, 'consentYes'), callback: `rc:${review.id}:1` },
                    { text: copy(locale, 'consentNo'), callback: `rc:${review.id}:0` },
                  ],
                ],
              },
              { customerId: customer.id, templateKey: 'review_photo_code' },
            );
        }
        return;
      }
      ctx.session.review = undefined;
    }
    await this.toInbox(
      ctx,
      ctx.message!.caption ?? null,
      largest.file_id,
      ctx.session.ask ?? 'advice',
    );
  }

  private async text(ctx: Ctx): Promise<void> {
    const text = ctx.message!.text!;
    const { locale, customer } = ctx.forest;
    if (text.startsWith('/')) return; // unknown command
    if (isCopyLabel(text, 'adviceButton')) {
      ctx.session.ask = 'advice';
      await this.say(ctx, html(copy(locale, 'advicePrompt')));
      return;
    }
    if (isCopyLabel(text, 'deliveryButton')) {
      await this.bot.sendRecorded(
        this.chat(ctx),
        {
          text: html(copy(locale, 'deliveryInfo')),
          inline: [
            [
              {
                text: copy(locale, 'moreOnSite'),
                url: this.site(locale, '/yetkazish-tolov', 'delivery'),
              },
            ],
          ],
        },
        { customerId: customer?.id ?? null },
      );
      return;
    }
    const flow = ctx.session.review;
    if (flow && customer && (await this.reviews.own(flow.reviewId, customer.id))) {
      if (await this.reviews.setTextOnce(flow.reviewId, text)) {
        await this.say(ctx, html(copy(locale, 'reviewTextThanks')));
        return;
      }
    }
    await this.toInbox(ctx, text, null, ctx.session.ask ?? 'other');
  }

  /** Voice, video, documents, stickers: the operator sees that something arrived. */
  private async other(ctx: Ctx): Promise<void> {
    const m = ctx.message!;
    const kind = m.voice
      ? '[ovozli xabar]'
      : m.video || m.video_note
        ? '[video]'
        : m.document
          ? '[fayl]'
          : m.sticker
            ? null
            : '[xabar]';
    if (kind)
      await this.toInbox(
        ctx,
        m.caption ? `${kind} ${m.caption}` : kind,
        null,
        ctx.session.ask ?? 'other',
      );
  }

  /** Flow 4: the message goes to the operator inbox; auto-reply when it opened a conversation. */
  private async toInbox(
    ctx: Ctx,
    text: string | null,
    photoFileId: string | null,
    topic: BotConversationTopic,
  ): Promise<void> {
    const { customer, locale } = ctx.forest;
    ctx.session.ask = undefined;
    const r = await this.inbox.customerMessage({
      chatId: this.chat(ctx),
      customerId: customer?.id ?? null,
      topic: photoFileId && topic === 'other' ? 'advice' : topic,
      text,
      photoFileId,
      firstName: ctx.from!.first_name,
      locale,
    });
    if (r?.opened)
      await this.inbox.autoReply(
        this.chat(ctx),
        customer?.id ?? null,
        { ism: ctx.from!.first_name },
        locale,
      );
  }
}

/** "Du–Sha" / "Пн–Сб" for a contiguous weekday set (0 = Sunday), else a list. */
export function dayRange(days: readonly number[], locale: Locale): string {
  if (!days.length) return '';
  const names = DAY_NAMES[locale];
  const order = [...new Set(days)].map((d) => (d + 6) % 7).sort((a, b) => a - b); // Monday first
  const name = (mondayFirst: number) => names[(mondayFirst + 1) % 7]!;
  const contiguous = order.every((d, i) => i === 0 || d === order[i - 1]! + 1);
  if (contiguous && order.length > 1) return `${name(order[0]!)}–${name(order[order.length - 1]!)}`;
  return order.map(name).join(', ');
}
