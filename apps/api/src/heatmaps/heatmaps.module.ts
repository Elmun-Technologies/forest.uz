import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { RateLimiter } from '../customer/common/rate-limit';
import { HeatmapAggregatorService } from './heatmap-aggregator.service';
import { ReplayRetentionService } from './replay-retention.service';
import { ReplayUploadController } from './replay-upload.controller';
import { ReplayUploadService } from './replay-upload.service';

export const HEATMAPS_QUEUE = 'heatmaps';
export const AGGREGATE_JOB = 'heatmaps.aggregate';
export const PURGE_JOB = 'replays.purge';
/** Hourly runs rebuild today and yesterday (late batches, sessions crossing midnight). */
const HOURLY_DAYS = 2;
const BACKFILL_DAYS = 30;

@Processor(HEATMAPS_QUEUE)
export class HeatmapsProcessor extends WorkerHost {
  constructor(
    private readonly aggregator: HeatmapAggregatorService,
    private readonly retention: ReplayRetentionService,
  ) {
    super();
  }

  async process(job: Job<{ days?: number }>): Promise<unknown> {
    if (job.name === AGGREGATE_JOB) return this.aggregator.aggregate(job.data.days ?? HOURLY_DAYS);
    if (job.name === PURGE_JOB) return this.retention.purge();
    return undefined;
  }
}

@Injectable()
export class HeatmapsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger('Heatmaps');

  constructor(
    @InjectQueue(HEATMAPS_QUEUE) private readonly queue: Queue,
    private readonly aggregator: HeatmapAggregatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      AGGREGATE_JOB,
      { every: 3_600_000 },
      { name: AGGREGATE_JOB, data: { days: HOURLY_DAYS } },
    );
    await this.queue.upsertJobScheduler(
      PURGE_JOB,
      { pattern: '40 3 * * *', tz: 'Asia/Tashkent' },
      { name: PURGE_JOB },
    );
    if (await this.aggregator.isEmpty()) {
      this.logger.log(`heatmap tables empty — backfilling ${BACKFILL_DAYS} days`);
      await this.enqueueAggregate(BACKFILL_DAYS);
    }
  }

  /** On demand (A3 "Qayta hisoblash", boot backfill); one pending run per size. */
  async enqueueAggregate(days: number): Promise<void> {
    await this.queue.add(
      AGGREGATE_JOB,
      { days },
      { jobId: `aggregate-${days}`, removeOnComplete: true, removeOnFail: true },
    );
  }
}

/** Replay upload, heatmap aggregation and replay retention (queue `heatmaps`). */
@Module({
  imports: [BullModule.registerQueue({ name: HEATMAPS_QUEUE })],
  controllers: [ReplayUploadController],
  providers: [
    ReplayUploadService,
    HeatmapAggregatorService,
    ReplayRetentionService,
    HeatmapsProcessor,
    HeatmapsScheduler,
    RateLimiter,
  ],
  exports: [HeatmapAggregatorService, ReplayRetentionService, HeatmapsScheduler],
})
export class HeatmapsModule {}
