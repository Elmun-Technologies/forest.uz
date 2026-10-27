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
    // Partitions exist months ahead: a boot that can't get the lock now must not fail or hang.
    await this.ensureEventPartitions().catch((e: unknown) => {
      if (!isLockTimeout(e)) throw e;
      this.logger.warn('Event partitions: lock still busy, left to the daily job');
    });
    // Daily at 03:10 Tashkent; idempotent upsert, safe with several API replicas.
    await this.queue.upsertJobScheduler(
      ENSURE_PARTITIONS,
      { pattern: '10 3 * * *', tz: 'Asia/Tashkent' },
      { name: ENSURE_PARTITIONS },
    );
  }

  async ensureEventPartitions(monthsAhead = 3): Promise<{ defaultRows: number }> {
    await this.createPartitions(monthsAhead);
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

  /**
   * `CREATE TABLE … PARTITION OF "Event"` needs an ACCESS EXCLUSIVE lock on the parent (and the
   * DEFAULT partition). Queued behind a long reader (heatmap rebuild, analytics), that request would
   * block every later Event insert/select until the reader ends, so it waits at most
   * `PARTITION_LOCK_TIMEOUT` per attempt and retries; after the last attempt it throws (the job
   * retries with backoff, boot just logs).
   */
  private async createPartitions(monthsAhead: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${PARTITION_LOCK_TIMEOUT}'`);
          await tx.$executeRaw`SELECT ensure_event_partitions(${monthsAhead}::int)`;
        });
        return;
      } catch (e) {
        if (!isLockTimeout(e) || attempt >= PARTITION_LOCK_ATTEMPTS) throw e;
        this.logger.warn(`Event partitions: lock busy (attempt ${attempt}), retrying`);
        await new Promise((r) => setTimeout(r, attempt * 2_000));
      }
    }
  }
}

const PARTITION_LOCK_TIMEOUT = '3s';
const PARTITION_LOCK_ATTEMPTS = 5;

/** Postgres `lock_not_available` (55P03), as Prisma surfaces it from a raw query. */
function isLockTimeout(e: unknown): boolean {
  const meta = (e as { meta?: { code?: unknown } } | null)?.meta;
  return meta?.code === '55P03' || /lock timeout/i.test(String(e));
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
