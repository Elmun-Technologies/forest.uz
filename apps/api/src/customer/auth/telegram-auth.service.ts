import { Injectable } from '@nestjs/common';
import { DomainError, type Locale, type TelegramAuthInput } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimiter } from '../common/rate-limit';
import { TELEGRAM_LOGIN_POLICY, type TelegramUser, verifyTelegramLogin } from './telegram-login';

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * "Telegram orqali kirish" (docs/05 `POST /auth/telegram`) and linking Telegram to an OTP
 * account (`POST /me/telegram/link`). The widget payload is verified against the connected
 * `telegram` integration's bot token (CLAUDE.md §6).
 */
@Injectable()
export class TelegramAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Throws RATE_LIMITED / INTEGRATION_NOT_CONFIGURED / TELEGRAM_AUTH_INVALID / _EXPIRED. */
  async verify(
    payload: TelegramAuthInput,
    ip: string | null,
    now = new Date(),
  ): Promise<TelegramUser> {
    await this.limiter.consume(
      'tg-auth:ip',
      ip ?? 'unknown',
      TELEGRAM_LOGIN_POLICY.perIpPerMinute,
      60,
    );
    const bot = await this.integrations.telegramLogin();
    if (!bot) throw new DomainError('INTEGRATION_NOT_CONFIGURED', { integration: 'telegram' });
    const r = verifyTelegramLogin(payload, bot.botToken, Math.floor(now.getTime() / 1000));
    if (!r.ok)
      throw new DomainError(
        r.reason === 'expired' ? 'TELEGRAM_AUTH_EXPIRED' : 'TELEGRAM_AUTH_INVALID',
      );
    return r.user;
  }

  /** Customer of this Telegram account, created on first login (no phone until they give one). */
  async findOrCreate(user: TelegramUser, locale: Locale): Promise<string> {
    const existing = await this.prisma.customer.findUnique({ where: { telegramId: user.id } });
    if (existing && !existing.deletedAt) {
      await this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          telegramUsername: user.username,
          ...(existing.name ? {} : { name: displayName(user) }),
        },
      });
      return existing.id;
    }
    if (existing) {
      // Erased customer: the Telegram identity starts over as a new customer.
      await this.prisma.customer.update({
        where: { id: existing.id },
        data: { telegramId: null, telegramUsername: null },
      });
    }
    try {
      const created = await this.prisma.customer.create({
        data: {
          telegramId: user.id,
          telegramUsername: user.username,
          name: displayName(user),
          locale,
          leadSource: 'telegram_login',
          leadAt: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      // Two simultaneous first logins: the other request created it.
      if (!isUniqueViolation(e)) throw e;
      const row = await this.prisma.customer.findUniqueOrThrow({ where: { telegramId: user.id } });
      return row.id;
    }
  }

  /**
   * Attaches the Telegram account to `customerId`. A phone-less Telegram-only customer holding it
   * (an earlier widget login) is absorbed: its addresses and favourites move over and it is
   * erased. Any other holder → TELEGRAM_ALREADY_LINKED (an operator decides).
   */
  async link(customerId: string, user: TelegramUser): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const holder = await tx.customer.findUnique({
          where: { telegramId: user.id },
          include: { _count: { select: { orders: true } } },
        });
        if (holder && holder.id !== customerId) {
          if (holder.phone !== null || holder._count.orders > 0 || holder.deletedAt)
            throw new DomainError('TELEGRAM_ALREADY_LINKED');
          await this.absorb(tx, holder.id, customerId);
        }
        await tx.customer.update({
          where: { id: customerId },
          data: { telegramId: user.id, telegramUsername: user.username },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError('TELEGRAM_ALREADY_LINKED');
      throw e;
    }
  }

  private async absorb(
    tx: Prisma.TransactionClient,
    stubId: string,
    intoId: string,
  ): Promise<void> {
    const hasDefault = await tx.address.count({ where: { customerId: intoId, isDefault: true } });
    await tx.address.updateMany({
      where: { customerId: stubId },
      data: { customerId: intoId, ...(hasDefault ? { isDefault: false } : {}) },
    });
    const favs = await tx.favorite.findMany({ where: { customerId: stubId } });
    if (favs.length)
      await tx.favorite.createMany({
        data: favs.map((f) => ({
          customerId: intoId,
          productId: f.productId,
          createdAt: f.createdAt,
        })),
        skipDuplicates: true,
      });
    await tx.favorite.deleteMany({ where: { customerId: stubId } });
    await tx.customer.update({
      where: { id: stubId },
      data: { telegramId: null, telegramUsername: null, name: null, deletedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: 'customer.telegram_merged',
        entity: 'Customer',
        entityId: intoId,
        after: { absorbedCustomerId: stubId },
      },
    });
  }
}

function displayName(user: TelegramUser): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name ? name.slice(0, 80) : null;
}
