import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CommerceModule } from '../commerce/commerce.module';
import { AuthModule } from '../customer/auth/auth.module';
import { CustomerCommonModule } from '../customer/common/customer-common.module';
import { BotAlertsService } from './bot-alerts.service';
import { BotInboxService } from './bot-inbox.service';
import { BotReviewsService } from './bot-reviews.service';
import { BotSubscribersService } from './bot-subscribers.service';
import { BotUpdatesService } from './bot-updates.service';
import { BotPublicController, DevBotController, TelegramWebhookController } from './bot.controller';
import { CartRestoreService } from './cart-restore.service';
import { StartLinksService } from './start-links.service';

export const BOT_QUEUE = 'bot';
export const BOT_ALERTS_SCAN = 'bot.alerts.scan';

/** Queue `bot`: `bot.alerts.scan` every minute (failed payments, SLA risk, integration errors). */
@Processor(BOT_QUEUE)
export class BotJobsProcessor extends WorkerHost {
  constructor(private readonly alerts: BotAlertsService) {
    super();
  }

  async process(job: Job): Promise<number> {
    return job.name === BOT_ALERTS_SCAN ? this.alerts.scan() : 0;
  }
}

@Injectable()
export class BotScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(BOT_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      BOT_ALERTS_SCAN,
      { every: 60_000 },
      { name: BOT_ALERTS_SCAN },
    );
  }
}

/** Telegram bot (docs/09): webhook, flows 1–5, commands, start links, cart restore, alert jobs. */
@Module({
  imports: [
    BullModule.registerQueue({ name: BOT_QUEUE }),
    CommerceModule,
    AuthModule,
    CustomerCommonModule,
  ],
  controllers: [TelegramWebhookController, BotPublicController, DevBotController],
  providers: [
    BotSubscribersService,
    BotInboxService,
    BotReviewsService,
    StartLinksService,
    CartRestoreService,
    BotUpdatesService,
    BotJobsProcessor,
    BotScheduler,
  ],
  exports: [BotInboxService],
})
export class BotModule {}
