import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type LeadResultDto,
  type Locale,
  leadSchema,
  waitlistSchema,
} from '@forest/contracts';
import type { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { ConsentsService } from '../common/consents';
import { TemplateSms } from '../common/messaging';
import { RateLimiter } from '../common/rate-limit';
import { signDeepLink, telegramDeepLink } from '../deeplink';

/** First-order code handed out by the lead popup and the bot (docs/02). */
export const LEAD_PROMO_CODE = 'SALOM10';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Leads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly consents: ConsentsService,
    private readonly sms: TemplateSms,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Same response for new and known phones (no account enumeration). The promo SMS goes out at
   * most once a day per phone, so repeated submits can't be used to spam someone.
   */
  async create(
    input: z.infer<typeof leadSchema>,
    ip: string | null,
    locale: Locale,
  ): Promise<LeadResultDto> {
    await this.limiter.consume('lead:ip', ip ?? 'unknown', 10, 3600);
    await this.limiter.consume('lead:phone', input.phone, 5, 86_400);

    const now = new Date();
    const customerId = await this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.upsert({
        where: { phone: input.phone },
        create: { phone: input.phone, locale, leadSource: input.source, leadAt: now },
        update: {},
        select: { id: true, leadSource: true },
      });
      if (!c.leadSource)
        await tx.customer.update({
          where: { id: c.id },
          data: { leadSource: input.source, leadAt: now },
        });
      if (input.marketingConsent === true)
        await this.consents.record(tx, c.id, { smsMarketing: true }, input.source);
      return c.id;
    });

    const store = await this.settings.get('store.info');
    if (await this.limiter.once('lead:sms', input.phone, 86_400)) {
      try {
        await this.sms.send({
          phone: input.phone,
          templateKey: 'lead_promo_sms',
          locale,
          vars: { kod: LEAD_PROMO_CODE, link: `${this.env.APP_URL.replace(/\/$/, '')}/${locale}` },
          customerId,
          record: true,
          // Requested by the customer right now (not an unsolicited campaign) → outside marketing caps.
          marketing: false,
        });
      } catch (e) {
        // The lead is captured either way; the code is also shown on screen and in the bot.
        this.logger.warn(`lead SMS failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const token = signDeepLink({ kind: 'lead', src: input.source }, this.env.SESSION_SECRET);
    return {
      promoCode: LEAD_PROMO_CODE,
      telegramDeepLink: telegramDeepLink(store.telegramBot, token),
    };
  }

  /** Idempotent per (variant, phone) while the entry is not yet notified. */
  async waitlist(input: z.infer<typeof waitlistSchema>, ip: string | null): Promise<void> {
    await this.limiter.consume('waitlist:ip', ip ?? 'unknown', 20, 3600);
    const variant = await this.prisma.variant.findFirst({
      where: { id: input.variantId, active: true, product: { status: 'ACTIVE' } },
      select: { id: true, productId: true },
    });
    if (!variant) throw new DomainError('PRODUCT_NOT_FOUND', undefined, 'variantId');

    await this.prisma.$transaction(async (tx) => {
      // No unique index on (variant, phone): serialize concurrent submits of the same pair.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waitlist:${variant.id}:${input.phone}`}))`;
      const existing = await tx.waitlistEntry.findFirst({
        where: { variantId: variant.id, phone: input.phone, notifiedAt: null },
        select: { id: true },
      });
      if (existing) return;
      const customer = await tx.customer.findUnique({
        where: { phone: input.phone },
        select: { id: true },
      });
      await tx.waitlistEntry.create({
        data: {
          productId: variant.productId,
          variantId: variant.id,
          phone: input.phone,
          customerId: customer?.id ?? null,
          channel: 'SMS',
        },
      });
    });
  }
}
