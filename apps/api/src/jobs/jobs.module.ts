import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MAINTENANCE_QUEUE, MaintenanceProcessor, MaintenanceService } from './maintenance.service';
import { WorkerShutdown } from './worker-shutdown';

@Module({
  imports: [
    DiscoveryModule,
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        prefix: 'forest',
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
  ],
  providers: [MaintenanceService, MaintenanceProcessor, WorkerShutdown],
  exports: [MaintenanceService],
})
export class JobsModule {}
