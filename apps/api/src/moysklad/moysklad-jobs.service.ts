import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { MoyskladSyncScope } from '@forest/contracts';
import type { Queue } from 'bullmq';
import type { InventoryItemType } from '../integrations/providers/types';
import { RedisService } from '../redis/redis.module';
import { CatalogSyncService } from './catalog-sync.service';
import { MoyskladBusyError, type MoyskladLease, withMoyskladLock } from './moysklad-lock';
import { MoyskladLogService } from './moysklad-log.service';
import { MoyskladSettingsService, type MoyskladState } from './moysklad-settings.service';
import { ITEM_REFRESH, MOYSKLAD_QUEUE, STOCK_REFRESH, SYNC_NOW } from './moysklad-queue';
import { OrderSyncService } from './order-sync.service';

const ITEM_TYPES: readonly InventoryItemType[] = ['product', 'variant', 'bundle'];

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/**
 * Job bodies of the `moysklad` queue: each checks that the integration may run and its flow is on,
 * then works under the MoySklad lock. Scheduled runs skip when another run holds the lock (the next
 * tick catches up); webhook refreshes and "sync now" wait for it.
 */
@Injectable()
export class MoyskladJobs {
  constructor(
    @InjectQueue(MOYSKLAD_QUEUE) private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly settings: MoyskladSettingsService,
    private readonly catalog: CatalogSyncService,
    private readonly orderSync: OrderSyncService,
    private readonly log: MoyskladLogService,
  ) {}

  private locked<T>(run: (lease: MoyskladLease) => Promise<T>, waitMs: number): Promise<T> {
    return withMoyskladLock(this.redis, run, { waitMs });
  }

  /** Scheduled work: skipped when busy; failures land in the sync log, not in BullMQ retries. */
  private async scheduled(
    kind: 'product' | 'stock' | 'order',
    run: (lease: MoyskladLease) => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return await this.locked(run, 0);
    } catch (e) {
      if (e instanceof MoyskladBusyError) return 'busy';
      await this.log.log(kind, false, `Sinxronlash xatosi: ${errorText(e)}`);
      return 'failed';
    }
  }

  async reconcile(): Promise<unknown> {
    const state = await this.settings.runnable(false);
    if (!state?.settings.flows.products) return 'off';
    return this.scheduled('product', (lease) => this.catalog.pullAll(state, lease));
  }

  async stock(manual: boolean): Promise<unknown> {
    const state = await this.settings.runnable(manual);
    if (!state?.settings.flows.stock) return 'off';
    return this.scheduled('stock', (lease) => this.catalog.pollStock(state, { manual, lease }));
  }

  async orders(manual: boolean): Promise<unknown> {
    // Runs with the orders flow off too: pushed orders' reserves must still be released.
    const state = await this.settings.runnable(manual);
    if (!state) return 'off';
    return this.scheduled('order', (lease) => this.orderSync.syncDue(state, new Date(), lease));
  }

  /** Webhook: one entity. Waits for the lock and throws on failure (BullMQ retries it). */
  async item(data: Record<string, unknown>): Promise<unknown> {
    const type = ITEM_TYPES.find((t) => t === data.type);
    const id = typeof data.id === 'string' ? data.id : null;
    if (!type || !id) return 'invalid';
    const state = await this.settings.runnable(false);
    if (!state?.settings.flows.products || !state.settings.flows.webhooks) return 'off';
    return this.locked((lease) => this.catalog.refreshItem(state, type, id, lease), 60_000);
  }

  /** Admin "Hozir sinxronlash": runs the chosen scope now and always writes a summary row. */
  async syncNow(data: Record<string, unknown>): Promise<unknown> {
    const scope: MoyskladSyncScope =
      data.scope === 'stock' || data.scope === 'orders' ? data.scope : 'all';
    const state = await this.settings.runnable(true);
    if (!state) {
      await this.log.log('sync', false, 'MoySklad ulanmagan — sinxronlash bajarilmadi');
      return 'off';
    }
    try {
      const parts = await this.locked((lease) => this.runScope(state, scope, lease), 60_000);
      await this.log.log('sync', true, `Qo'lda sinxronlash tugadi: ${parts.join('; ')}`);
      return parts;
    } catch (e) {
      await this.log.log('sync', false, `Qo'lda sinxronlash xatosi: ${errorText(e)}`);
      return 'failed';
    }
  }

  private async runScope(
    state: MoyskladState,
    scope: MoyskladSyncScope,
    lease: MoyskladLease,
  ): Promise<string[]> {
    const { flows } = state.settings;
    const parts: string[] = [];
    if (scope === 'all') {
      if (flows.products) {
        const s = await this.catalog.pullAll(state, lease);
        parts.push(`mahsulotlar ${s.checked} (o'zgardi ${s.changed}, yangi ${s.created})`);
      } else if (flows.stock) {
        parts.push(
          `qoldiq ${await this.catalog.pollStock(state, { manual: true, lease })} o'zgardi`,
        );
      } else parts.push("mahsulot va qoldiq oqimlari o'chiq");
    }
    if (scope === 'stock') {
      parts.push(
        flows.stock
          ? `qoldiq ${await this.catalog.pollStock(state, { manual: true, lease })} o'zgardi`
          : "qoldiq oqimi o'chiq",
      );
    }
    if (scope === 'all' || scope === 'orders') {
      if (flows.orders) {
        const s = await this.orderSync.syncDue(state, new Date(), lease);
        parts.push(`buyurtmalar: ${s.pushed} yuborildi, ${s.updated} holat, ${s.failed} xato`);
      } else parts.push("buyurtmalar oqimi o'chiq");
    }
    return parts;
  }

  // ── Enqueue (admin, webhook) ──

  async enqueueSyncNow(scope: MoyskladSyncScope): Promise<void> {
    // One pending manual run per scope: repeated clicks collapse into it.
    await this.queue.add(
      SYNC_NOW,
      { scope },
      { jobId: `sync-now-${scope}`, removeOnComplete: true, removeOnFail: true, attempts: 1 },
    );
  }

  async enqueueItem(type: InventoryItemType, id: string): Promise<void> {
    await this.queue.add(
      ITEM_REFRESH,
      { type, id },
      // A burst of events for one entity collapses into one re-read shortly after.
      { jobId: `item-${type}-${id}`, delay: 2_000, removeOnComplete: true, removeOnFail: true },
    );
  }

  async enqueueStockRefresh(): Promise<void> {
    await this.queue.add(
      STOCK_REFRESH,
      {},
      { jobId: 'stock-refresh', delay: 3_000, removeOnComplete: true, removeOnFail: true },
    );
  }
}
