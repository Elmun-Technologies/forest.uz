import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WebhookCollector } from './collector.service';
import { WebhookSender } from './sender.service';
import { WebhookSecrets } from './webhook-secrets';

export const WEBHOOKS_QUEUE = 'webhooks';
export const COLLECT_JOB = 'webhooks.collect';
export const SEND_JOB = 'webhooks.send';
const EVERY_MS = 15_000;

/** Outbound webhooks (CLAUDE.md §5/§6): collect committed events, then send due deliveries. */
@Processor(WEBHOOKS_QUEUE)
export class WebhooksProcessor extends WorkerHost {
  constructor(
    private readonly collector: WebhookCollector,
    private readonly sender: WebhookSender,
  ) {
    super();
  }

  async process(job: Job): Promise<number> {
    if (job.name === COLLECT_JOB) return this.collector.collect();
    if (job.name === SEND_JOB) return this.sender.sendDue();
    return 0;
  }
}

@Injectable()
export class WebhooksScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger('WebhooksScheduler');

  constructor(@InjectQueue(WEBHOOKS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(COLLECT_JOB, { every: EVERY_MS }, { name: COLLECT_JOB });
      await this.queue.upsertJobScheduler(SEND_JOB, { every: EVERY_MS }, { name: SEND_JOB });
    } catch (e) {
      this.logger.warn(`schedule failed: ${String(e)}`);
    }
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOKS_QUEUE })],
  providers: [
    WebhookSecrets,
    WebhookCollector,
    WebhookSender,
    WebhooksProcessor,
    WebhooksScheduler,
  ],
  exports: [WebhookSecrets, WebhookCollector, WebhookSender],
})
export class WebhooksOutModule {}
