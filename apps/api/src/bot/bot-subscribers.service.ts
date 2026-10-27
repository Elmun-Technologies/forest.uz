import { Inject, Injectable, Logger } from '@nestjs/common';
import { botLocale, DomainError, type Locale, normalizeUzPhone } from '@forest/contracts';
import { type BotSubscriber, type Customer, Prisma } from '@forest/db';
import { ConsentsService } from '../customer/common/consents';
import { TemplateSms } from '../customer/common/messaging';
import { RateLimiter } from '../customer/common/rate-limit';
import { TelegramAuthService } from '../customer/auth/telegram-auth.service';
import { LEAD_PROMO_CODE } from '../customer/leads/leads.service';
import { UnsubscribeService } from '../messaging/unsubscribe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../tracking/identity.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** The Telegram user behind an update (grammY `ctx.from`). */
export interface BotUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
}

export type ContactResult =
  | { ok: true; customerId: string; created: boolean }
  | { ok: false; reason: 'not_own' | 'invalid' | 'conflict' };

const visitorKey = (telegramId: bigint) => `tg:visitor:${telegramId}`;

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Bot subscribers and their link to customers (CLAUDE.md §6, 5A): only a Telegram-verified phone
 * (request_contact of the sender's own number) attaches a chat to a customer.
 */
@Injectable()
export class BotSubscribersService {
  private readonly logger = new Logger('BotSubscribers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentsService,
    private readonly unsubscribe: UnsubscribeService,
    private readonly telegramAuth: TelegramAuthService,
    private readonly identity: IdentityService,
    private readonly sms: TemplateSms,
    private readonly limiter: RateLimiter,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Every update: the chat exists, is not blocked (any update proves it) and was seen now. */
  async touch(from: BotUser, now = new Date()): Promise<BotSubscriber> {
    const data = {
      username: from.username ?? null,
      firstName: from.first_name.slice(0, 64),
      languageCode: from.language_code?.slice(0, 8) ?? null,
      lastSeenAt: now,
      blockedAt: null,
    };
    return this.prisma.botSubscriber.upsert({
      where: { telegramId: BigInt(from.id) },
      create: { telegramId: BigInt(from.id), ...data, startedAt: now },
      update: data,
    });
  }

  /** The chat's customer (not erased), if linked. */
  async customer(telegramId: number | bigint): Promise<Customer | null> {
    const c = await this.prisma.customer.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return c && !c.deletedAt ? c : null;
  }

  async locale(sub: BotSubscriber, customer?: Customer | null): Promise<Locale> {
    const rules = await this.settings.get('messaging.rules');
    return botLocale({
      explicit: sub.locale,
      customer: customer?.locale ?? null,
      languageCode: sub.languageCode,
      enabled: rules.languages,
    });
  }

  /**
   * `/start`: remembers the first source + visitor touch; a stopped subscriber who starts again
   * gets marketing back (explicit action). Returns whether marketing was re-enabled.
   */
  async start(
    sub: BotSubscriber,
    ref: { source: string | null; anonymousId: string | null },
  ): Promise<{ resubscribed: boolean }> {
    let utm: Prisma.InputJsonValue | undefined;
    if (ref.anonymousId) {
      const visitor = await this.prisma.visitor.findUnique({
        where: { anonymousId: ref.anonymousId },
        select: { lastTouch: true, firstTouch: true },
      });
      const touch = (visitor?.lastTouch ?? visitor?.firstTouch) as Prisma.InputJsonValue | null;
      if (touch) utm = touch;
    }
    await this.prisma.botSubscriber.update({
      where: { telegramId: sub.telegramId },
      data: {
        ...(sub.source ? {} : { source: ref.source ?? 'bot' }),
        ...(!sub.utm && utm ? { utm } : {}),
      },
    });
    if (ref.anonymousId) await this.rememberVisitor(sub.telegramId, ref.anonymousId);
    if (!sub.stoppedAt) {
      // Starting the bot = opting in to its reminders (docs/13 q.90), but never over an earlier
      // explicit opt-out from another place (SMS link, cabinet): only when no TELEGRAM row exists.
      const customer = await this.customer(sub.telegramId);
      if (customer) {
        const any = await this.prisma.consent.count({
          where: { customerId: customer.id, channel: 'TELEGRAM' },
        });
        if (!any) await this.consents.record(this.prisma, customer.id, { telegram: true }, 'bot');
      }
      return { resubscribed: false };
    }
    await this.prisma.botSubscriber.update({
      where: { telegramId: sub.telegramId },
      data: { stoppedAt: null },
    });
    const customer = await this.customer(sub.telegramId);
    if (customer) await this.consents.record(this.prisma, customer.id, { telegram: true }, 'bot');
    return { resubscribed: true };
  }

  /** The visitor of the start link waits for the phone (stitched on contact), 30 days. */
  private async rememberVisitor(telegramId: bigint, anonymousId: string): Promise<void> {
    await this.redis.set(visitorKey(telegramId), anonymousId, 'EX', 30 * 24 * 3600);
  }

  /**
   * request_contact: the sender's own, Telegram-verified number → that phone's customer gets this
   * Telegram (created when missing). Lead + TELEGRAM consent + SALOM10 SMS + visitor stitching.
   */
  async linkContact(
    from: BotUser,
    contact: { phone_number: string; user_id?: number },
    opts: { anonymousId?: string | null; locale: Locale; leadOn: boolean },
    now = new Date(),
  ): Promise<ContactResult> {
    if (contact.user_id !== from.id) return { ok: false, reason: 'not_own' };
    const phone = normalizeUzPhone(contact.phone_number);
    if (!phone) return { ok: false, reason: 'invalid' };
    const tgId = BigInt(from.id);
    const user = {
      id: tgId,
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
    };
    let created = false;
    let customerId: string;
    try {
      const existing = await this.prisma.customer.findUnique({ where: { phone } });
      if (existing) {
        customerId = existing.id;
        const holder = await this.prisma.customer.findUnique({ where: { telegramId: tgId } });
        // The Telegram user now owns this number (Telegram attests it like an OTP): an account
        // with another phone that holds this Telegram id lets go of it.
        if (holder && holder.id !== existing.id && holder.phone !== null)
          await this.prisma.customer.update({
            where: { id: holder.id },
            data: { telegramId: null, telegramUsername: null },
          });
        if (existing.telegramId !== tgId) await this.telegramAuth.link(existing.id, user);
      } else {
        const holder = await this.prisma.customer.findUnique({ where: { telegramId: tgId } });
        if (holder && !holder.deletedAt && holder.phone === null) {
          customerId = holder.id;
          await this.prisma.customer.update({ where: { id: holder.id }, data: { phone } });
        } else {
          if (holder)
            await this.prisma.customer.update({
              where: { id: holder.id },
              data: { telegramId: null, telegramUsername: null },
            });
          const c = await this.prisma.customer.create({
            data: {
              phone,
              telegramId: tgId,
              telegramUsername: from.username ?? null,
              name:
                [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 80) || null,
              locale: opts.locale,
              leadSource: 'bot',
              leadAt: now,
            },
            select: { id: true },
          });
          customerId = c.id;
          created = true;
        }
      }
    } catch (e) {
      if (e instanceof DomainError && e.code === 'TELEGRAM_ALREADY_LINKED')
        return { ok: false, reason: 'conflict' };
      if (isUniqueViolation(e)) return { ok: false, reason: 'conflict' };
      throw e;
    }

    await this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      if (!c.leadSource)
        await tx.customer.update({ where: { id: c.id }, data: { leadSource: 'bot', leadAt: now } });
      await tx.botSubscriber.update({
        where: { telegramId: tgId },
        data: { customerId, phoneSharedAt: now, stoppedAt: null },
      });
      await this.consents.record(tx, customerId, { telegram: true }, 'bot');
    });

    const anonymousId = opts.anonymousId ?? (await this.redis.getdel(visitorKey(tgId)));
    if (anonymousId) await this.identity.link(anonymousId, customerId);

    if (opts.leadOn && (await this.limiter.once('lead:sms', phone, 86_400))) {
      await this.sms
        .send({
          phone,
          templateKey: 'lead_promo_sms',
          locale: opts.locale,
          vars: {
            kod: LEAD_PROMO_CODE,
            link: `${this.env.APP_URL.replace(/\/$/, '')}/${opts.locale}`,
          },
          customerId,
          record: true,
          marketing: false,
        })
        .catch((e: unknown) => this.logger.warn(`lead SMS from bot failed: ${String(e)}`));
    }
    return { ok: true, customerId, created };
  }

  /** `/stop` and "Eslatmani o'chirish": TELEGRAM marketing consent revoked (service continues). */
  async stop(telegramId: number | bigint, now = new Date()): Promise<void> {
    await this.prisma.botSubscriber.updateMany({
      where: { telegramId: BigInt(telegramId) },
      data: { stoppedAt: now },
    });
    const customer = await this.customer(telegramId);
    if (customer) await this.unsubscribe.revoke(customer.id, 'TELEGRAM', 'bot');
  }

  /** `/til`: the chat's language, and the customer's site/SMS language too. */
  async setLocale(telegramId: number | bigint, locale: Locale): Promise<void> {
    await this.prisma.botSubscriber.update({
      where: { telegramId: BigInt(telegramId) },
      data: { locale },
    });
    const customer = await this.customer(telegramId);
    if (customer)
      await this.prisma.customer.update({ where: { id: customer.id }, data: { locale } });
  }

  /** `my_chat_member` → kicked: the user blocked the bot. */
  async blocked(telegramId: number | bigint, now = new Date()): Promise<void> {
    await this.prisma.botSubscriber.updateMany({
      where: { telegramId: BigInt(telegramId) },
      data: { blockedAt: now },
    });
  }
}
