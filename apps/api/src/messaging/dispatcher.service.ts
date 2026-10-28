import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Locale,
  MARKETING_OPT_OUT,
  type MessageChannelKey,
  type MessageKind,
  renderTemplate,
  t,
  type TemplateButton,
  tashkentDayStart,
  templateMeta,
  OPT_OUT_VARIABLE,
  templateVariables,
} from '@forest/contracts';
import { Prisma, type Message, type MessageStatus } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import type { MessengerButton } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { applyParkedEskizStatus } from './eskiz-status';
import { decideSend } from './policy';
import {
  MARKETING_STOP_CALLBACK,
  TELEGRAM_SENDER,
  type TelegramFlow,
  type TelegramSender,
} from './telegram-sender';
import { UnsubscribeService, unsubscribeUrl } from './unsubscribe';

type Tx = Prisma.TransactionClient;

/** Re-checked at delivery: a reminder that is no longer true is skipped, not sent. */
export type MessageGuard =
  | { type: 'cart'; cartId: string; updatedAt: string }
  | { type: 'review'; orderId: string }
  | { type: 'waitlist'; variantId: string }
  | { type: 'segment'; segmentId: string; addedAt: string };

/** `Message.payload`: refs and rendering data only — no phone numbers or names. */
interface MessagePayload {
  locale: Locale;
  orderId?: string;
  waitlistEntryId?: string;
  buttons?: MessengerButton[][];
  photoUrl?: string;
  flow?: TelegramFlow;
  guard?: MessageGuard;
}

export interface EnqueueInput {
  templateKey: string;
  /** Defaults to the catalog kind of the key (audience automations pass `marketing`). */
  kind?: MessageKind;
  customerId: string | null;
  /** Preference order; the first usable channel wins. */
  channels: MessageChannelKey[];
  locale?: Locale;
  vars: Record<string, string | number | null | undefined>;
  /** Producer idempotency: a second enqueue with the same key returns the first row. */
  dedupeKey?: string;
  /** Order messages: SMS goes to `Order.contactPhone`, the timeline gets NOTIFICATION_SENT. */
  orderId?: string;
  /** Anonymous waitlist entries: SMS goes to the entry's phone. */
  waitlistEntryId?: string;
  photoUrl?: string;
  flow?: TelegramFlow;
  guard?: MessageGuard;
  now?: Date;
}

export type DeliveryOutcome =
  | 'SENT'
  | 'FAILED'
  | 'DEFERRED'
  | 'IN_FLIGHT'
  | Exclude<MessageStatus, 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED'>
  | 'DONE';

const LEASE_MS = 5 * 60_000;
/** An unclaimed row without `sendAfter` this old missed its first attempt (crash, restart). */
const ORPHAN_AFTER_MS = 2 * 60_000;
const ORPHAN_MAX_AGE_MS = 60 * 60_000;
const SCENARIO_OF_GUARD = {
  cart: 'abandonedCart',
  review: 'reviewRequest',
  waitlist: 'waitlist',
} as const;

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * The one send path for customer messages (CLAUDE.md §6 "Messaging engine"): order statuses,
 * automations, waitlist and audience messages all enqueue here, and every send passes
 * `decideSend()` (service always; marketing: consent per channel, daily cap across channels,
 * quiet hours → deferred; opt-out added to every marketing message).
 */
@Injectable()
export class MessageDispatcher {
  private readonly logger = new Logger('Messaging');
  /** Keys already reported as missing/inactive/unapproved by this process (one warning each). */
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
    private readonly unsubscribe: UnsubscribeService,
    @Inject(TELEGRAM_SENDER) private readonly telegram: TelegramSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Creates the message row (or returns the existing one for `dedupeKey`) and tries to deliver it
   * at once. Returns null when nothing was recorded (missing/inactive template, erased customer).
   */
  async enqueue(input: EnqueueInput): Promise<{ id: string; outcome: DeliveryOutcome } | null> {
    const now = input.now ?? new Date();
    if (input.dedupeKey) {
      const existing = await this.prisma.message.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, outcome: 'DONE' };
    }
    const template = await this.prisma.messageTemplate.findUnique({
      where: { key: input.templateKey },
    });
    if (!template?.active) {
      this.warnOnce(
        `inactive:${input.templateKey}`,
        `message template "${input.templateKey}" is missing or inactive: message skipped`,
      );
      return null;
    }
    const kind = input.kind ?? templateMeta(input.templateKey)?.kind ?? 'service';
    const customer = input.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: input.customerId },
          select: { id: true, publicId: true, locale: true, telegramId: true, deletedAt: true },
        })
      : null;
    if (customer?.deletedAt) return null;
    if (kind === 'marketing' && !customer) throw new Error('marketing messages need a customer');
    const locale = input.locale ?? customer?.locale ?? 'uz';
    const consent = customer ? await this.consent(this.prisma, customer.id) : null;

    // Channel: the first one we can reach (and, for marketing, may use).
    let channel: MessageChannelKey | null = null;
    let skip: { status: MessageStatus; reason: string } | null = null;
    for (const [i, c] of input.channels.entries()) {
      if (c === 'TELEGRAM') {
        if (!customer?.telegramId) {
          skip ??= { status: 'SKIPPED', reason: 'no telegram chat' };
          continue;
        }
        if (kind === 'marketing' && !consent?.telegram) {
          skip ??= { status: 'SKIPPED_NO_CONSENT', reason: 'no TELEGRAM consent' };
          continue;
        }
      } else {
        if (!(await this.phoneFor(input, customer?.id ?? null))) {
          skip ??= { status: 'SKIPPED', reason: 'no phone' };
          continue;
        }
        if (i > 0 && !template.smsFallback) {
          skip ??= { status: 'SKIPPED', reason: 'sms fallback off' };
          continue;
        }
        if (!template.smsApproved) {
          this.warnOnce(
            `unapproved:${template.key}`,
            `SMS text "${template.key}" is not marked Eskiz-approved: SMS skipped`,
          );
          skip ??= { status: 'SKIPPED', reason: 'sms text not approved' };
          continue;
        }
        if (kind === 'marketing' && !consent?.sms) {
          skip ??= { status: 'SKIPPED_NO_CONSENT', reason: 'no SMS_MARKETING consent' };
          continue;
        }
      }
      channel = c;
      break;
    }

    const text = t(template.body as { uz: string; ru: string }, locale);
    // Marketing: the opt-out link is the template's own `{stop}` slot (the approved SMS text).
    const vars =
      kind === 'marketing' && customer && channel
        ? {
            ...input.vars,
            [OPT_OUT_VARIABLE]: unsubscribeUrl(
              this.env.APP_URL,
              locale,
              this.unsubscribe.tokenFor(channel, customer.publicId),
            ),
          }
        : input.vars;
    const body = renderTemplate(text, vars);
    // A missing variable matters only for a usable channel (else the channel's reason stands).
    if (channel && body === null) skip = { status: 'SKIPPED', reason: 'missing variable' };
    const payload: MessagePayload = {
      locale,
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.waitlistEntryId ? { waitlistEntryId: input.waitlistEntryId } : {}),
      ...(input.guard ? { guard: input.guard } : {}),
    };
    if (channel && body !== null) {
      skip = null;
      if (
        channel === 'SMS' &&
        kind === 'marketing' &&
        !templateVariables(text).includes(OPT_OUT_VARIABLE)
      ) {
        this.warnOnce(
          `nostop:${template.key}`,
          `marketing SMS "${template.key}" has no {stop} opt-out slot: SMS skipped`,
        );
        skip = { status: 'SKIPPED', reason: 'no opt-out slot' };
      } else if (channel === 'TELEGRAM') {
        const buttons = this.buttons(template.buttons, locale, input.vars);
        if (kind === 'marketing')
          buttons.push([
            {
              text: MARKETING_OPT_OUT.telegramButton[locale],
              callbackData: MARKETING_STOP_CALLBACK,
            },
          ]);
        if (buttons.length) payload.buttons = buttons;
        if (input.photoUrl) payload.photoUrl = input.photoUrl;
        if (input.flow) payload.flow = input.flow;
      }
    }

    let row: Message;
    try {
      row = await this.prisma.message.create({
        data: {
          customerId: customer?.id ?? null,
          channel: channel ?? input.channels[0] ?? 'SMS',
          templateKey: template.key,
          body: body ?? '',
          kind,
          marketing: kind === 'marketing',
          status: skip?.status ?? 'QUEUED',
          error: skip?.reason ?? null,
          dedupeKey: input.dedupeKey ?? null,
          payload: payload as unknown as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
    } catch (e) {
      if (input.dedupeKey && isUniqueViolation(e)) {
        const existing = await this.prisma.message.findUniqueOrThrow({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        return { id: existing.id, outcome: 'DONE' };
      }
      throw e;
    }
    if (row.status !== 'QUEUED') return { id: row.id, outcome: row.status as DeliveryOutcome };
    return { id: row.id, outcome: await this.deliver(row.id, now) };
  }

  /**
   * Job `messaging.outbox.flush`: sends deferred rows that are due (quiet hours over), retries rows
   * whose first attempt never ran (process stopped between enqueue and deliver, ≤ 1 h old) and
   * closes older such orphans as SKIPPED — a status text hours late helps nobody.
   */
  async flushDue(now = new Date(), limit = 200): Promise<number> {
    const orphanBefore = new Date(now.getTime() - ORPHAN_AFTER_MS);
    const staleBefore = new Date(now.getTime() - ORPHAN_MAX_AGE_MS);
    await this.prisma.message.updateMany({
      where: { status: 'QUEUED', claimedAt: null, sendAfter: null, createdAt: { lt: staleBefore } },
      data: { status: 'SKIPPED', error: 'not delivered within 1 h (stale)' },
    });
    const due = await this.prisma.message.findMany({
      where: {
        status: 'QUEUED',
        claimedAt: null,
        OR: [
          { sendAfter: { lte: now } },
          { sendAfter: null, createdAt: { lte: orphanBefore, gte: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: limit,
    });
    let sent = 0;
    for (const { id } of due) {
      try {
        if ((await this.deliver(id, now)) === 'SENT') sent++;
      } catch (e) {
        this.logger.error(`queued message ${id} failed: ${String(e)}`);
      }
    }
    return sent;
  }

  /**
   * Decides (policy, relevance) and claims the row under its lock, then sends outside the
   * transaction. A claimed row is never sent twice: a stale lease ends FAILED, not resent
   * (Eskiz has no idempotency).
   */
  async deliver(id: string, now = new Date()): Promise<DeliveryOutcome> {
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Message" WHERE "id" = ${id} FOR UPDATE`;
      const msg = await tx.message.findUniqueOrThrow({ where: { id } });
      if (msg.status !== 'QUEUED') return { outcome: 'DONE' as const };
      if (msg.claimedAt) {
        if (now.getTime() - msg.claimedAt.getTime() < LEASE_MS)
          return { outcome: 'IN_FLIGHT' as const };
        await tx.message.update({
          where: { id },
          data: { status: 'FAILED', error: 'send interrupted (lease expired); not retried' },
        });
        return { outcome: 'FAILED' as const };
      }
      if (msg.sendAfter && msg.sendAfter > now) return { outcome: 'DEFERRED' as const };
      const finish = async (status: MessageStatus, reason: string) => {
        await tx.message.update({ where: { id }, data: { status, error: reason } });
        return { outcome: status as DeliveryOutcome };
      };
      const payload = (msg.payload ?? { locale: 'uz' }) as unknown as MessagePayload;
      const customer = msg.customerId
        ? await tx.customer.findUnique({
            where: { id: msg.customerId },
            select: { id: true, telegramId: true, deletedAt: true },
          })
        : null;
      if (msg.customerId && (!customer || customer.deletedAt))
        return finish('SKIPPED', 'customer erased');
      if (msg.kind === 'marketing' && customer)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`msg:${customer.id}`}))`;

      const template = msg.templateKey
        ? await tx.messageTemplate.findUnique({ where: { key: msg.templateKey } })
        : null;
      if (!template?.active) return finish('SKIPPED', 'template inactive');
      if (msg.channel === 'SMS' && !template.smsApproved)
        return finish('SKIPPED', 'sms text not approved');
      if (msg.channel === 'TELEGRAM' && !customer?.telegramId)
        return finish('SKIPPED', 'no telegram chat');

      const rules = await this.settings.get('messaging.rules');
      if (payload.guard) {
        const scenario =
          payload.guard.type === 'segment' ? null : SCENARIO_OF_GUARD[payload.guard.type];
        if (scenario && !rules.scenarios[scenario])
          return finish('SKIPPED', `scenario ${scenario} off`);
        const stale = await this.irrelevant(tx, payload.guard, msg.customerId);
        if (stale) return finish('SKIPPED', `no longer relevant: ${stale}`);
      }
      const decision = decideSend({
        kind: msg.kind as MessageKind,
        channel: msg.channel,
        now,
        rules,
        consent: customer ? await this.consent(tx, customer.id) : { sms: false, telegram: false },
        marketingToday:
          msg.kind === 'marketing' && customer
            ? await this.marketingToday(tx, customer.id, id, now)
            : 0,
      });
      if (decision.action === 'skip') return finish(decision.status, decision.reason);
      if (decision.action === 'defer') {
        await tx.message.update({ where: { id }, data: { sendAfter: decision.until } });
        return { outcome: 'DEFERRED' as const };
      }
      await tx.message.update({ where: { id }, data: { claimedAt: now } });
      return {
        outcome: 'CLAIMED' as const,
        msg,
        payload,
        chatId: customer?.telegramId ?? null,
        template,
      };
    });
    if (claim.outcome !== 'CLAIMED') return claim.outcome;
    return this.send(claim.msg, claim.payload, claim.chatId, claim.template.smsFallback, now);
  }

  private async send(
    msg: Message,
    payload: MessagePayload,
    chatId: bigint | null,
    smsFallback: boolean,
    now: Date,
  ): Promise<DeliveryOutcome> {
    try {
      let providerId: string;
      if (msg.channel === 'TELEGRAM') {
        const r = await this.telegram.sendMessage({
          chatId: String(chatId),
          text: msg.body,
          ...(payload.buttons ? { buttons: payload.buttons } : {}),
          ...(payload.photoUrl ? { photoUrl: payload.photoUrl } : {}),
          ...(payload.flow ? { flow: payload.flow } : {}),
        });
        providerId = r.messageId;
      } else {
        const phone = await this.phoneFor(payload, msg.customerId);
        if (!phone) throw new Error('no phone');
        const sms = await this.integrations.sms();
        providerId = (await sms.send({ phone, text: msg.body, templateKey: msg.templateKey ?? '' }))
          .providerId;
      }
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { status: 'SENT', providerId, sentAt: now, error: null },
      });
      if (msg.channel === 'SMS')
        // An Eskiz delivery report that beat this write was parked by the callback.
        await applyParkedEskizStatus(this.redis, this.prisma, providerId).catch((e: unknown) =>
          this.logger.warn(`parked status for ${msg.templateKey} failed: ${String(e)}`),
        );
      if (payload.orderId)
        await this.prisma.orderEvent.create({
          data: {
            orderId: payload.orderId,
            type: 'NOTIFICATION_SENT',
            actorType: 'SYSTEM',
            data: { channel: msg.channel, template: msg.templateKey, messageId: msg.id },
          },
        });
      return 'SENT';
    } catch (e) {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: {
          status: 'FAILED',
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        },
      });
      this.logger.warn(`${msg.channel} ${msg.templateKey} failed: ${String(e)}`);
      // The chat is gone (blocked bot, no chat, bot off): a non-marketing message still goes by SMS.
      if (msg.channel === 'TELEGRAM' && msg.kind !== 'marketing' && smsFallback)
        await this.smsTwin(msg, payload, now);
      return 'FAILED';
    }
  }

  /** Same text by SMS (only for non-marketing texts: no opt-out line differs). */
  private async smsTwin(msg: Message, payload: MessagePayload, now: Date): Promise<void> {
    const template = await this.prisma.messageTemplate.findUnique({
      where: { key: msg.templateKey ?? '' },
    });
    const phone = await this.phoneFor(payload, msg.customerId);
    const usable = template?.smsApproved && phone;
    try {
      const twin = await this.prisma.message.create({
        data: {
          customerId: msg.customerId,
          channel: 'SMS',
          templateKey: msg.templateKey,
          body: msg.body,
          kind: msg.kind,
          marketing: false,
          status: usable ? 'QUEUED' : 'SKIPPED',
          error: usable ? null : phone ? 'sms text not approved' : 'no phone',
          dedupeKey: `${msg.dedupeKey ?? msg.id}:sms`,
          payload: {
            locale: payload.locale,
            orderId: payload.orderId,
            waitlistEntryId: payload.waitlistEntryId,
            guard: payload.guard,
          } as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
      if (usable) await this.deliver(twin.id, now);
    } catch (e) {
      if (!isUniqueViolation(e))
        this.logger.error(`SMS fallback for ${msg.id} failed: ${String(e)}`);
    }
  }

  private async phoneFor(
    ref: { orderId?: string; waitlistEntryId?: string },
    customerId: string | null,
  ): Promise<string | null> {
    if (ref.orderId) {
      const o = await this.prisma.order.findUnique({
        where: { id: ref.orderId },
        select: { contactPhone: true },
      });
      return o?.contactPhone || null;
    }
    if (ref.waitlistEntryId) {
      const w = await this.prisma.waitlistEntry.findUnique({
        where: { id: ref.waitlistEntryId },
        select: { phone: true },
      });
      if (w?.phone) return w.phone;
    }
    if (!customerId) return null;
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { phone: true },
    });
    return c?.phone ?? null;
  }

  /** Latest consent row per channel (append-only log, docs/02). */
  private async consent(db: Tx | PrismaService, customerId: string) {
    const rows = await db.consent.findMany({
      where: { customerId, channel: { in: ['SMS_MARKETING', 'TELEGRAM'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['channel'],
      select: { channel: true, granted: true },
    });
    const of = (c: string) => rows.find((r) => r.channel === c)?.granted ?? false;
    return { sms: of('SMS_MARKETING'), telegram: of('TELEGRAM') };
  }

  /** Marketing sent or in flight since Tashkent midnight, every channel. */
  private marketingToday(tx: Tx, customerId: string, exceptId: string, now: Date): Promise<number> {
    const since = tashkentDayStart(now);
    return tx.message.count({
      where: {
        customerId,
        kind: 'marketing',
        id: { not: exceptId },
        OR: [
          { status: { in: ['SENT', 'DELIVERED'] }, sentAt: { gte: since } },
          { status: 'QUEUED', claimedAt: { gte: since } },
        ],
      },
    });
  }

  /** Why a reminder no longer applies (null = still relevant). */
  private async irrelevant(
    tx: Tx,
    guard: MessageGuard,
    customerId: string | null,
  ): Promise<string | null> {
    switch (guard.type) {
      case 'cart': {
        const cart = await tx.cart.findUnique({
          where: { id: guard.cartId },
          select: { status: true, updatedAt: true, _count: { select: { items: true } } },
        });
        if (!cart || cart.status !== 'ACTIVE') return 'cart converted';
        if (cart.updatedAt.toISOString() !== guard.updatedAt) return 'cart changed';
        if (cart._count.items === 0) return 'cart empty';
        const ordered = customerId
          ? await tx.order.count({ where: { customerId, createdAt: { gt: cart.updatedAt } } })
          : 0;
        return ordered ? 'ordered since' : null;
      }
      case 'review': {
        const order = await tx.order.findUnique({
          where: { id: guard.orderId },
          select: { status: true },
        });
        if (!order || !['DELIVERED', 'COMPLETED'].includes(order.status))
          return 'order not delivered';
        const reviewed = await tx.review.count({ where: { orderId: guard.orderId } });
        return reviewed ? 'already reviewed' : null;
      }
      case 'waitlist': {
        const v = await tx.variant.findUnique({
          where: { id: guard.variantId },
          select: {
            active: true,
            stock: true,
            reserved: true,
            product: { select: { status: true } },
          },
        });
        return v && v.active && v.product.status === 'ACTIVE' && v.stock - v.reserved > 0
          ? null
          : 'out of stock';
      }
      case 'segment': {
        const m = await tx.segmentMember.findUnique({
          where: {
            segmentId_customerId: { segmentId: guard.segmentId, customerId: customerId ?? '' },
          },
          select: { addedAt: true, removedAt: true, segment: { select: { active: true } } },
        });
        if (!m || m.removedAt || m.addedAt.toISOString() !== guard.addedAt)
          return 'left the audience';
        return m.segment.active ? null : 'audience inactive';
      }
    }
  }

  private buttons(raw: unknown, locale: Locale, vars: EnqueueInput['vars']): MessengerButton[][] {
    const list = Array.isArray(raw) ? (raw as TemplateButton[]) : [];
    const rows: MessengerButton[][] = [];
    for (const b of list) {
      const url = b.url === '{link}' ? vars.link : b.url;
      if (typeof url === 'string' && url) rows.push([{ text: b.text[locale], url }]);
    }
    return rows;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }
}
