import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CatalogSyncService } from './catalog-sync.service';
import { MoyskladLogService } from './moysklad-log.service';
import { MoyskladJobs } from './moysklad-jobs.service';
import { MoyskladSettingsService } from './moysklad-settings.service';
import {
  ITEM_REFRESH,
  MOYSKLAD_QUEUE,
  ORDERS_SYNC,
  RECONCILE,
  STOCK_POLL,
  STOCK_REFRESH,
  SYNC_NOW,
} from './moysklad-queue';
import { MoyskladWebhookController } from './moysklad-webhook.controller';
import { OrderSyncService } from './order-sync.service';

/** Dispatches the `moysklad` queue's jobs (CLAUDE.md §5) to `MoyskladJobs`. */
@Processor(MOYSKLAD_QUEUE)
export class MoyskladProcessor extends WorkerHost {
  constructor(private readonly jobs: MoyskladJobs) {
    super();
  }

  async process(job: Job<Record<string, unknown>>): Promise<unknown> {
    switch (job.name) {
      case RECONCILE:
        return this.jobs.reconcile();
      case STOCK_POLL:
      case STOCK_REFRESH:
        return this.jobs.stock(false);
      case ORDERS_SYNC:
        return this.jobs.orders(false);
      case ITEM_REFRESH:
        return this.jobs.item(job.data);
      case SYNC_NOW:
        return this.jobs.syncNow(job.data);
      default:
        return undefined;
    }
  }
}

@Injectable()
export class MoyskladScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger('MoySklad');

  constructor(
    @InjectQueue(MOYSKLAD_QUEUE) private readonly queue: Queue,
    private readonly settings: MoyskladSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(RECONCILE, { every: 3_600_000 }, { name: RECONCILE });
    await this.queue.upsertJobScheduler(ORDERS_SYNC, { every: 60_000 }, { name: ORDERS_SYNC });
    await this.reschedule().catch((e: unknown) =>
      this.logger.warn(`stock poll schedule: ${String(e)}`),
    );
  }

  /** Stock poll cadence follows the setting (called again when an admin saves it). */
  async reschedule(): Promise<void> {
    const { settings } = await this.settings.state();
    await this.queue.upsertJobScheduler(
      STOCK_POLL,
      { every: settings.stockPollMinutes * 60_000 },
      { name: STOCK_POLL },
    );
  }
}

/** MoySklad sync (CLAUDE.md §6): catalog/stock pull, order push, webhook, queue. */
@Module({
  imports: [BullModule.registerQueue({ name: MOYSKLAD_QUEUE })],
  controllers: [MoyskladWebhookController],
  providers: [
    MoyskladSettingsService,
    MoyskladLogService,
    CatalogSyncService,
    OrderSyncService,
    MoyskladJobs,
    MoyskladProcessor,
    MoyskladScheduler,
  ],
  exports: [MoyskladSettingsService, MoyskladLogService, MoyskladJobs, MoyskladScheduler],
})
export class MoyskladModule {}
