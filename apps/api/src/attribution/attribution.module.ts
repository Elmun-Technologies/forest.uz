import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { AttributionService } from './attribution.service';

/** Own queue: a worker takes every job of its queue, so names stay apart from other modules. */
export const ATTRIBUTION_QUEUE = 'attribution';
export const ATTRIBUTION_COMPUTE = 'analytics.attribution.compute';

@Processor(ATTRIBUTION_QUEUE)
export class AttributionProcessor extends WorkerHost {
  constructor(private readonly attribution: AttributionService) {
    super();
  }

  async process(job: Job): Promise<number> {
    return job.name === ATTRIBUTION_COMPUTE ? this.attribution.computePending() : 0;
  }
}

@Injectable()
export class AttributionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(ATTRIBUTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ATTRIBUTION_COMPUTE,
      { every: 60_000 },
      { name: ATTRIBUTION_COMPUTE },
    );
  }
}

/** Order attribution (docs/07): every minute, purchases without `Order.attribution` get one. */
@Module({
  imports: [BullModule.registerQueue({ name: ATTRIBUTION_QUEUE })],
  providers: [AttributionService, AttributionProcessor, AttributionScheduler],
  exports: [AttributionService],
})
export class AttributionModule {}
