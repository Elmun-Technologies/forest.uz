import { Injectable, Logger } from '@nestjs/common';
import type { MoyskladLogKind } from '@forest/contracts';
import { IntegrationsService } from '../integrations/integrations.service';
import type { InventoryItemType } from '../integrations/providers/types';
import { RedisService } from '../redis/redis.module';

const LAST = 'forest:moysklad:last:';
const TYPES = 'forest:moysklad:types';

export type SyncArea = 'catalog' | 'stock' | 'orders';

/**
 * Sync log rows (IntegrationLog `moysklad`, shown on A13 "Sinxron jurnali") and small runtime
 * facts kept in Redis: last successful run per area, and each MoySklad id's entity type (order
 * positions must reference `product`, `variant` or `bundle`). Messages carry SKUs and order
 * numbers only — never names or phones.
 */
@Injectable()
export class MoyskladLogService {
  private readonly logger = new Logger('MoySklad');

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly redis: RedisService,
  ) {}

  async log(
    kind: MoyskladLogKind,
    ok: boolean,
    message: string,
    opts: { direction?: 'IN' | 'OUT'; payload?: unknown } = {},
  ): Promise<void> {
    if (!ok) this.logger.warn(`${kind}: ${message}`);
    await this.integrations
      .log('moysklad', {
        direction: opts.direction ?? 'IN',
        kind,
        ok,
        message,
        payload: opts.payload,
      })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }

  /** Writes at most `cap` detail rows, then one row saying how many were left out. */
  async logMany(
    rows: { kind: MoyskladLogKind; ok: boolean; message: string }[],
    cap: number,
    direction: 'IN' | 'OUT' = 'IN',
  ): Promise<void> {
    for (const r of rows.slice(0, cap)) await this.log(r.kind, r.ok, r.message, { direction });
    if (rows.length > cap)
      await this.log(
        'sync',
        true,
        `… yana ${rows.length - cap} ta o'zgarish (jurnalga yozilmadi)`,
        {
          direction,
        },
      );
  }

  async markSynced(area: SyncArea, at = new Date()): Promise<void> {
    await this.redis.set(`${LAST}${area}`, at.toISOString());
  }

  async lastSynced(area: SyncArea): Promise<Date | null> {
    const v = await this.redis.get(`${LAST}${area}`);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  async rememberTypes(entries: { externalId: string; type: InventoryItemType }[]): Promise<void> {
    if (!entries.length) return;
    await this.redis.hset(TYPES, Object.fromEntries(entries.map((e) => [e.externalId, e.type])));
  }

  async typeOf(externalId: string): Promise<InventoryItemType | null> {
    const t = await this.redis.hget(TYPES, externalId);
    return t === 'product' || t === 'variant' || t === 'bundle' ? t : null;
  }
}
