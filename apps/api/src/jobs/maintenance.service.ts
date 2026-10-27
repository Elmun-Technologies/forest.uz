import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const MAINTENANCE_QUEUE = 'maintenance';
const ENSURE_PARTITIONS = 'events.partitions.ensure';

/**
 * Keeps monthly Event partitions created ahead of time (docs/04) and alerts when rows leak into
 * the DEFAULT partition (that would block creating the month's partition later).
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureEventPartitions();
    // Daily at 03:10 Tashkent; idempotent upsert, safe with several API replicas.
    await this.queue.upsertJobScheduler(
      ENSURE_PARTITIONS,
      { pattern: '10 3 * * *', tz: 'Asia/Tashkent' },
      { name: ENSURE_PARTITIONS },
    );
  }

  async ensureEventPartitions(monthsAhead = 3): Promise<{ defaultRows: number }> {
    await this.prisma.$executeRaw`SELECT ensure_event_partitions(${monthsAhead}::int)`;
    const [row] = await this.prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT event_default_partition_rows() AS n`;
    const defaultRows = Number(row?.n ?? 0n);
    if (defaultRows > 0) {
      // TODO(phase-5): route to the admin Telegram alerts group.
      this.logger.error(
        `Event DEFAULT partition has ${defaultRows} rows — create the missing monthly partition and move them`,
      );
    }
    return { defaultRows };
  }
}

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(private readonly maintenance: MaintenanceService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === ENSURE_PARTITIONS) return this.maintenance.ensureEventPartitions();
    return undefined;
  }
}
