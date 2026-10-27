import { Inject, Injectable, Logger } from '@nestjs/common';
import { t } from '@forest/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { applyParkedEskizStatus } from '../messaging/eskiz-status';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';

/** Fills `{ism}`-style variables; unknown variables are left empty rather than shown raw. */
export function fillMessage(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Service messages about an order (always allowed, no marketing consent needed — docs/02).
 * Phase 1: SMS only; Telegram-first with SMS fallback arrives with the bot (Phase 5).
 * Never throws: a failed notification must not break checkout or payment handling.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  /** Missing/inactive template keys already reported by this process (one warning each). */
  private readonly missingTemplates = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async orderStatus(
    orderId: string,
    templateKey: string,
    extra: Record<string, string> = {},
  ): Promise<void> {
    try {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { customer: true },
      });
      const template = await this.prisma.messageTemplate.findUnique({
        where: { key: templateKey },
      });
      if (!template?.active) {
        // Deploys run only migrations; a template the seed never reached means silent SMS loss.
        if (!this.missingTemplates.has(templateKey)) {
          this.missingTemplates.add(templateKey);
          this.logger.warn(`message template "${templateKey}" is missing or inactive: SMS skipped`);
        }
        return;
      }
      const text = fillMessage(t(template.body, order.locale), {
        ism: order.contactName.split(' ')[0] ?? '',
        raqam: order.number,
        link: `${this.env.APP_URL}/t/${order.trackingToken}`,
        ...extra,
      });
      const message = await this.prisma.message.create({
        data: {
          customerId: order.customerId,
          channel: 'SMS',
          templateKey,
          body: text,
          marketing: false,
        },
      });
      try {
        const sms = await this.integrations.sms();
        const { providerId } = await sms.send({ phone: order.contactPhone, text, templateKey });
        await this.prisma.message.update({
          where: { id: message.id },
          data: { status: 'SENT', providerId, sentAt: new Date() },
        });
        // Eskiz may report delivery before this write landed (parked by the callback).
        await applyParkedEskizStatus(this.redis, this.prisma, providerId).catch((e: unknown) =>
          this.logger.warn(`parked status for ${templateKey} failed: ${String(e)}`),
        );
        await this.prisma.orderEvent.create({
          data: {
            orderId,
            type: 'NOTIFICATION_SENT',
            actorType: 'SYSTEM',
            data: { channel: 'SMS', template: templateKey },
          },
        });
      } catch (e) {
        await this.prisma.message.update({
          where: { id: message.id },
          data: { status: 'FAILED', error: String(e).slice(0, 300) },
        });
        throw e;
      }
    } catch (e) {
      this.logger.warn(`notification ${templateKey} for order ${orderId} failed: ${String(e)}`);
    }
  }
}
