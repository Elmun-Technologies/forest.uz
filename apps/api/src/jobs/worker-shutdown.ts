import { WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';

/**
 * Stops every BullMQ worker (waiting for its active job) before Prisma and Redis disconnect.
 * Nest runs `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`, and
 * @nestjs/bullmq only closes workers in `onApplicationShutdown`; with Prisma disconnecting earlier,
 * a job caught mid-transaction (heatmap day rebuild) left its connection "idle in transaction"
 * until the 120 s interactive-transaction timeout, holding locks on `Event` (CLAUDE.md §6).
 */
@Injectable()
export class WorkerShutdown implements BeforeApplicationShutdown {
  constructor(private readonly discovery: DiscoveryService) {}

  async beforeApplicationShutdown(): Promise<void> {
    const workers: Worker[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const host: unknown = wrapper.instance;
      if (!(host instanceof WorkerHost)) continue;
      try {
        workers.push(host.worker);
      } catch {
        // Not registered (manual registration / boot failed): nothing to stop.
      }
    }
    await Promise.all(workers.map((w) => w.close()));
  }
}
