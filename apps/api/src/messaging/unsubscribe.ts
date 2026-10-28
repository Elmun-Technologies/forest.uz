import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Injectable, Post, Req } from '@nestjs/common';
import {
  DomainError,
  type Locale,
  type UnsubscribeResultDto,
  unsubscribeInputSchema,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import type { Request } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../common/http';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ConsentsService } from '../customer/common/consents';
import { RateLimiter } from '../customer/common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Marketing opt-out links (docs/09: every marketing message can be switched off). The SMS carries
 * `<APP_URL>/<locale>/obuna/<token>`; token = channel letter + the customer's number (`C-10482` →
 * `10482`) + a 16-char HMAC. It only revokes a consent, so a short MAC is plenty, and it never
 * expires (an old SMS must still work).
 */
const SIG_LEN = 16;
type Channel = 'SMS' | 'TELEGRAM';
const LETTER: Record<Channel, string> = { SMS: 's', TELEGRAM: 't' };

/**
 * Dedicated key: HMAC-SHA256(SESSION_SECRET, "forest:unsubscribe:v1"), so these public tokens
 * never MAC with the raw session secret (domain separation from sessions and deep links).
 */
function unsubscribeKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('forest:unsubscribe:v1').digest();
}

function mac(body: string, key: Buffer | string): string {
  return createHmac('sha256', key).update(`unsub:${body}`).digest('base64url').slice(0, SIG_LEN);
}

export function signUnsubscribe(channel: Channel, publicId: string, secret: string): string {
  const digits = publicId.replace(/\D/g, '');
  const body = `${LETTER[channel]}${digits}`;
  return body + mac(body, unsubscribeKey(secret));
}

const macEquals = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Accepts tokens MACed with the dedicated key and — during the transition — the first-version
 * tokens MACed with the raw secret (SMS sent before the key change must keep working).
 */
export function verifyUnsubscribe(
  token: string,
  secret: string,
): { channel: Channel; publicId: string } | null {
  const body = token.slice(0, -SIG_LEN);
  const m = /^([st])(\d{1,12})$/.exec(body);
  if (!m || token.length <= SIG_LEN) return null;
  const given = token.slice(-SIG_LEN);
  const ok =
    macEquals(given, mac(body, unsubscribeKey(secret))) || macEquals(given, mac(body, secret));
  if (!ok) return null;
  return { channel: m[1] === 's' ? 'SMS' : 'TELEGRAM', publicId: `C-${m[2]}` };
}

export function unsubscribeUrl(appUrl: string, locale: Locale, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/${locale}/obuna/${token}`;
}

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class UnsubscribeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Revokes marketing on one channel (append-only consent log; a no-op when already revoked).
   * Used by the opt-out link, the bot's "Eslatmani o'chirish" button and `/stop`.
   */
  async revoke(customerId: string, channel: Channel, source: string, db: Db = this.prisma) {
    await this.consents.record(
      db,
      customerId,
      channel === 'SMS' ? { smsMarketing: false } : { telegram: false },
      source,
    );
  }

  tokenFor(channel: Channel, publicId: string): string {
    return signUnsubscribe(channel, publicId, this.env.SESSION_SECRET);
  }

  async byToken(token: string): Promise<UnsubscribeResultDto> {
    const parsed = verifyUnsubscribe(token, this.env.SESSION_SECRET);
    if (!parsed) throw new DomainError('UNSUBSCRIBE_INVALID');
    const customer = await this.prisma.customer.findUnique({
      where: { publicId: parsed.publicId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) throw new DomainError('UNSUBSCRIBE_INVALID');
    // An erased customer has nothing left to send to; answer the same way (no enumeration).
    if (!customer.deletedAt) await this.revoke(customer.id, parsed.channel, 'unsubscribe');
    return { channel: parsed.channel === 'SMS' ? 'sms' : 'telegram' };
  }
}

/** Storefront `/obuna/<token>` page posts here through the `/api/*` rewrite. */
@Controller('messaging')
export class UnsubscribeController {
  constructor(
    private readonly unsubscribe: UnsubscribeService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('unsubscribe')
  @HttpCode(200)
  async revoke(
    @Body(new ZodPipe(unsubscribeInputSchema)) body: z.infer<typeof unsubscribeInputSchema>,
    @Req() req: Request,
  ): Promise<UnsubscribeResultDto> {
    await this.limiter.consume('unsubscribe:ip', req.ip ?? 'unknown', 30, 60);
    return this.unsubscribe.byToken(body.token);
  }
}
