import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CustomerCommonModule } from '../customer/common/customer-common.module';
import { GeoIpService } from './geoip';
import { BACKFILL_JOB, IdentityService, TRACKING_QUEUE } from './identity.service';
import { IngestService } from './ingest.service';
import { DevEventsController, TrackingController } from './tracking.controller';

/** Queue `tracking`: `tracking.identity.backfill` (Event.customerId after an identity link). */
@Processor(TRACKING_QUEUE)
export class TrackingProcessor extends WorkerHost {
  constructor(private readonly identity: IdentityService) {
    super();
  }

  async process(job: Job<{ anonymousId: string; customerId: string }>): Promise<number> {
    if (job.name !== BACKFILL_JOB) return 0;
    return this.identity.backfill(job.data.anonymousId, job.data.customerId);
  }
}

/**
 * First-party analytics ingest (`POST /v1/t`), GeoIP, identity stitching. Global so login,
 * checkout and leads can call `IdentityService.link` without import churn.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: TRACKING_QUEUE }), CustomerCommonModule],
  controllers: [TrackingController, DevEventsController],
  providers: [IngestService, GeoIpService, IdentityService, TrackingProcessor],
  exports: [IdentityService, GeoIpService],
})
export class TrackingModule {}
