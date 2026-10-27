import { Injectable } from '@nestjs/common';
import {
  deliveryPromisePreview,
  type DeliveryPreviewDto,
  type DeliverySettingsDto,
  type DeliverySettingsInput,
  DomainError,
  legalComplete,
  type SettingKey,
  settingSchemas,
  type ReplaySettingsDto,
  type ReplaySettingsInput,
  type StoreSettingsDto,
  type StoreSettingsInput,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { PrismaService } from '../../prisma/prisma.service';
import { SeoEventsService } from '../../seo/seo-events.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

const STORE_KEYS = ['store.info'] as const satisfies readonly SettingKey[];
const TRACKING_KEYS = ['tracking.rules'] as const satisfies readonly SettingKey[];
const DELIVERY_KEYS = [
  'delivery.zones',
  'delivery.rules',
  'returns.rules',
] as const satisfies readonly SettingKey[];

type Tx = Prisma.TransactionClient;

/** JSON with sorted keys: jsonb reorders object keys, so plain stringify can't compare. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Admin A16 "Do'kon" and "Yetkazish" tabs over the `Setting` table. Values are validated with the
 * stricter admin schemas, then with `settingSchemas` (the read contract); every save is one
 * transaction with its audit row (before/after of the keys that changed) and a version check.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly seoEvents: SeoEventsService,
  ) {}

  /** Version token = newest `updatedAt` of the document's keys (optimistic concurrency). */
  private async rows(keys: readonly SettingKey[], db: Tx | PrismaService = this.prisma) {
    const rows = await db.setting.findMany({ where: { key: { in: [...keys] } } });
    const version = rows
      .map((r) => r.updatedAt.toISOString())
      .sort()
      .at(-1);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return { byKey, version: version ?? 'none' };
  }

  async store(): Promise<StoreSettingsDto> {
    const { byKey, version } = await this.rows(STORE_KEYS);
    const value = settingSchemas['store.info'].parse(byKey.get('store.info'));
    return { value, version, legalComplete: legalComplete(value.legal) };
  }

  async delivery(): Promise<DeliverySettingsDto> {
    const { byKey, version } = await this.rows(DELIVERY_KEYS);
    return {
      zones: settingSchemas['delivery.zones'].parse(byKey.get('delivery.zones')),
      rules: settingSchemas['delivery.rules'].parse(byKey.get('delivery.rules')),
      returns: settingSchemas['returns.rules'].parse(byKey.get('returns.rules')),
      version,
    };
  }

  async preview(at: Date): Promise<DeliveryPreviewDto> {
    return deliveryPromisePreview(await this.settings.get('delivery.zones'), at);
  }

  async saveStore(actor: AuditActor, input: StoreSettingsInput): Promise<StoreSettingsDto> {
    await this.save(actor, 'settings.store.update', STORE_KEYS, input.version, {
      'store.info': input.value,
    });
    return this.store();
  }

  async saveDelivery(
    actor: AuditActor,
    input: DeliverySettingsInput,
  ): Promise<DeliverySettingsDto> {
    await this.save(actor, 'settings.delivery.update', DELIVERY_KEYS, input.version, {
      'delivery.zones': [...input.zones].sort((a, b) => a.sort - b.sort),
      'delivery.rules': input.rules,
      'returns.rules': input.returns,
    });
    return this.delivery();
  }

  /** A3 replay kill switch and sample rates (`tracking.rules`). */
  async tracking(): Promise<ReplaySettingsDto> {
    const { byKey, version } = await this.rows(TRACKING_KEYS);
    const v = settingSchemas['tracking.rules'].parse(byKey.get('tracking.rules'));
    return {
      value: {
        replayEnabled: v.replayEnabled,
        replaySamplePct: v.replaySamplePct,
        replayCheckoutPct: v.replayCheckoutPct,
      },
      version,
    };
  }

  async saveTracking(actor: AuditActor, input: ReplaySettingsInput): Promise<ReplaySettingsDto> {
    const { byKey } = await this.rows(TRACKING_KEYS);
    // Keep any other `tracking.rules` fields; only the replay ones are edited here.
    const current = (byKey.get('tracking.rules') ?? {}) as Record<string, unknown>;
    await this.save(actor, 'settings.tracking.update', TRACKING_KEYS, input.version, {
      'tracking.rules': { ...current, ...input.value },
    });
    return this.tracking();
  }

  private async save(
    actor: AuditActor,
    action: string,
    keys: readonly SettingKey[],
    version: string,
    values: Partial<Record<SettingKey, unknown>>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent saves of the same document so the version check is exact.
      await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = ANY(${[...keys]}) FOR UPDATE`;
      const current = await this.rows(keys, tx);
      if (current.version !== version) throw new DomainError('SETTINGS_CONFLICT');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of keys) {
        if (!(key in values)) continue;
        // The read contract must accept what we store, or every reader would fail.
        const parsed = settingSchemas[key].parse(values[key]) as Prisma.InputJsonValue;
        const old = current.byKey.get(key);
        if (canonical(old) === canonical(parsed)) continue;
        before[key] = old ?? null;
        after[key] = parsed;
        await tx.setting.upsert({
          where: { key },
          update: { value: parsed, updatedBy: actor.staffId },
          create: { key, value: parsed, updatedBy: actor.staffId },
        });
      }
      await this.audit.record(
        actor,
        {
          action,
          entity: 'Setting',
          entityId: keys.join(','),
          before: Object.keys(before).length ? before : undefined,
          after: Object.keys(after).length ? after : { unchanged: true },
        },
        tx,
      );
    });
    this.settings.invalidate();
    // Storefront pages read these through `/settings/public` (fetch tag `settings`).
    this.seoEvents.settingsChanged(['settings']);
  }
}
