import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { AdSignalsService } from './ad-signals.service';
import { AdsProvidersService } from './ads-providers.service';
import { AudienceService } from './audience.service';
import {
  AUDIENCES_QUEUE,
  REFRESH_ALL,
  REFRESH_SEGMENT,
  SIGNALS_COLLECT,
  SIGNALS_SEND,
} from './audiences-queue';
import { DestinationsService } from './destinations.service';
import { withSegmentLock } from './segment-lock';

/** Job bodies of the `audiences` queue (CLAUDE.md §5). */
@Injectable()
export class AudienceJobs {
  private readonly logger = new Logger('AudienceJobs');

  constructor(
    @InjectQueue(AUDIENCES_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly audiences: AudienceService,
    private readonly destinations: DestinationsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Refresh then sync one segment (an inactive one only syncs: its uploads are removed), under
   * the segment lease; waits up to `waitMs` for a run in progress.
   */
  async segment(segmentId: string, waitMs = 120_000) {
    return withSegmentLock(
      this.redis,
      segmentId,
      async () => {
        const seg = await this.prisma.segment.findUnique({
          where: { id: segmentId },
          select: { active: true },
        });
        if (!seg) return 'missing' as const;
        let refresh: Awaited<ReturnType<AudienceService['refresh']>> = null;
        if (seg.active) {
          try {
            refresh = await this.audiences.refresh(segmentId);
          } catch (e) {
            // Membership is stale, but people who withdrew consent, were erased or changed
            // phone must still leave the platforms; then report the failure.
            await this.destinations.syncSegment(segmentId, { removalsOnly: true });
            throw e;
          }
        }
        const sync = await this.destinations.syncSegment(segmentId);
        return { refresh, sync };
      },
      waitMs,
    );
  }

  async all() {
    const segments = await this.prisma.segment.findMany({ select: { id: true } });
    let failed = 0;
    for (const s of segments) {
      try {
        await this.segment(s.id);
      } catch (e) {
        failed++;
        this.logger.error(`segment ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { segments: segments.length, failed };
  }

  async enqueueSegment(segmentId: string): Promise<void> {
    // Repeated saves collapse into one pending run per segment.
    await this.queue.add(
      REFRESH_SEGMENT,
      { segmentId },
      { jobId: `segment-${segmentId}`, removeOnComplete: true, removeOnFail: true, attempts: 1 },
    );
  }
}

@Processor(AUDIENCES_QUEUE)
export class AudiencesProcessor extends WorkerHost {
  constructor(
    private readonly jobs: AudienceJobs,
    private readonly signals: AdSignalsService,
  ) {
    super();
  }

  async process(job: Job<Record<string, unknown>>): Promise<unknown> {
    switch (job.name) {
      case REFRESH_ALL:
        return this.jobs.all();
      case REFRESH_SEGMENT:
        return typeof job.data.segmentId === 'string'
          ? this.jobs.segment(job.data.segmentId)
          : 'invalid';
      case SIGNALS_COLLECT:
        return this.signals.collect();
      case SIGNALS_SEND:
        return this.signals.send();
      default:
        return undefined;
    }
  }
}

@Injectable()
export class AudiencesScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(AUDIENCES_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(REFRESH_ALL, { every: 3_600_000 }, { name: REFRESH_ALL });
    await this.queue.upsertJobScheduler(
      SIGNALS_COLLECT,
      { every: 60_000 },
      { name: SIGNALS_COLLECT },
    );
    await this.queue.upsertJobScheduler(SIGNALS_SEND, { every: 60_000 }, { name: SIGNALS_SEND });
  }
}

/** Audiences A8 + ad signals (CLAUDE.md §6): refresh, destinations, server-side events. */
@Module({
  imports: [BullModule.registerQueue({ name: AUDIENCES_QUEUE })],
  providers: [
    AdsProvidersService,
    AudienceService,
    DestinationsService,
    AdSignalsService,
    AudienceJobs,
    AudiencesProcessor,
    AudiencesScheduler,
  ],
  exports: [
    AdsProvidersService,
    AudienceService,
    DestinationsService,
    AdSignalsService,
    AudienceJobs,
  ],
})
export class AudiencesModule {}
