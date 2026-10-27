import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CustomerCommonModule } from '../customer/common/customer-common.module';
import { MessagingAutomations } from './automations.service';
import { BotService } from '../bot/bot.service';
import { CartLinkService } from '../bot/cart-link.service';
import { CART_LINKS } from './cart-links';
import { MessageDispatcher } from './dispatcher.service';
import { EskizCallbackService } from './eskiz-callback.service';
import { EskizWebhookController } from './eskiz-webhook.controller';
import { TELEGRAM_SENDER } from './telegram-sender';
import { UnsubscribeController, UnsubscribeService } from './unsubscribe';

export const MESSAGING_QUEUE = 'messaging';
export const MESSAGING_JOBS = {
  flush: 'messaging.outbox.flush',
  carts: 'messaging.carts.remind',
  reviews: 'messaging.reviews.request',
  waitlist: 'messaging.waitlist.notify',
  segments: 'messaging.segments.auto',
} as const;

/**
 * The messaging engine (CLAUDE.md §6): one send path + opt-out. Global so order notifications
 * (commerce), the bot (5A) and admin can use the dispatcher / `UnsubscribeService`.
 * `TELEGRAM_SENDER` / `CART_LINKS` are the bot's `BotService` / `CartLinkService`.
 */
@Global()
@Module({
  imports: [CustomerCommonModule],
  providers: [
    UnsubscribeService,
    MessageDispatcher,
    MessagingAutomations,
    // The bot (global `BotCoreModule`, 5A) is the Telegram transport and signs cart links.
    { provide: TELEGRAM_SENDER, useExisting: BotService },
    { provide: CART_LINKS, useExisting: CartLinkService },
  ],
  exports: [UnsubscribeService, MessageDispatcher, MessagingAutomations, TELEGRAM_SENDER],
})
export class MessagingCoreModule {}

@Processor(MESSAGING_QUEUE)
export class MessagingProcessor extends WorkerHost {
  constructor(
    private readonly dispatcher: MessageDispatcher,
    private readonly automations: MessagingAutomations,
  ) {
    super();
  }

  async process(job: Job): Promise<number> {
    switch (job.name) {
      case MESSAGING_JOBS.flush:
        return this.dispatcher.flushDue();
      case MESSAGING_JOBS.carts:
        return this.automations.remindCarts();
      case MESSAGING_JOBS.reviews:
        return this.automations.requestReviews();
      case MESSAGING_JOBS.waitlist:
        return this.automations.notifyWaitlist();
      case MESSAGING_JOBS.segments:
        return this.automations.runSegmentMessages();
      default:
        return 0;
    }
  }
}

/** Every job runs each minute; each is idempotent (dedupe keys), so overlaps are harmless. */
@Injectable()
export class MessagingScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(MESSAGING_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const name of Object.values(MESSAGING_JOBS))
      await this.queue.upsertJobScheduler(name, { every: 60_000 }, { name });
  }
}

/** Inbound provider webhooks (Eskiz), the opt-out endpoint and the automation jobs. */
@Module({
  imports: [
    MessagingCoreModule,
    CustomerCommonModule,
    BullModule.registerQueue({ name: MESSAGING_QUEUE }),
  ],
  controllers: [EskizWebhookController, UnsubscribeController],
  providers: [EskizCallbackService, MessagingProcessor, MessagingScheduler],
})
export class MessagingModule {}
