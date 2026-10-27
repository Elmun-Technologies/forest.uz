import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MessageDispatcher } from '../messaging/dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Service messages about an order (always allowed, no marketing consent needed — docs/02):
 * Telegram first when the customer has a chat, SMS to `Order.contactPhone` otherwise or when the
 * chat can't be reached (docs/09). Goes through `MessageDispatcher`, the one send path.
 * Never throws: a failed notification must not break checkout or payment handling.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: MessageDispatcher,
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
        select: {
          customerId: true,
          locale: true,
          contactName: true,
          number: true,
          trackingToken: true,
        },
      });
      await this.dispatcher.enqueue({
        templateKey,
        kind: 'service',
        customerId: order.customerId,
        channels: ['TELEGRAM', 'SMS'],
        locale: order.locale,
        vars: {
          ism: order.contactName.split(' ')[0] ?? '',
          raqam: order.number,
          link: `${this.env.APP_URL}/t/${order.trackingToken}`,
          ...extra,
        },
        orderId,
        flow: { kind: 'order', orderId, templateKey },
      });
    } catch (e) {
      this.logger.warn(`notification ${templateKey} for order ${orderId} failed: ${String(e)}`);
    }
  }
}
