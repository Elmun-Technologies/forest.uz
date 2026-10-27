import { Injectable } from '@nestjs/common';
import {
  type PublicSettingsDto,
  type SettingKey,
  type SettingValue,
  settingSchemas,
} from '@forest/contracts';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 15_000;

/**
 * Typed access to the `Setting` table. Values are validated on read so a bad manual edit fails
 * loudly instead of silently breaking checkout. Short in-process cache; writes invalidate it.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<SettingKey, { value: unknown; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as SettingValue<K>;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) throw new Error(`Setting "${key}" is missing — run pnpm db:seed`);
    const value = settingSchemas[key].parse(row.value) as SettingValue<K>;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set<K extends SettingKey>(key: K, value: SettingValue<K>, staffId?: string): Promise<void> {
    const parsed = settingSchemas[key].parse(value);
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: parsed as object, updatedBy: staffId ?? null },
      create: { key, value: parsed as object, updatedBy: staffId ?? null },
    });
    this.cache.delete(key);
  }

  invalidate(): void {
    this.cache.clear();
  }

  async publicSettings(): Promise<PublicSettingsDto> {
    const [store, zones, rules, seo, flags, returns, telegram] = await Promise.all([
      this.get('store.info'),
      this.get('delivery.zones'),
      this.get('delivery.rules'),
      this.get('seo.verification'),
      this.get('flags'),
      this.get('returns.rules'),
      this.integrations.telegramLogin(),
    ]);
    const legalComplete = Object.values(store.legal).every(
      (v) => typeof v === 'string' && v.length > 0,
    );
    return {
      store: {
        name: store.name,
        domain: store.domain,
        phone: store.phone,
        email: store.email,
        hours: store.hours,
        telegramBot: store.telegramBot,
        instagram: store.instagram,
        offerVersion: store.offerVersion,
        legalComplete,
      },
      delivery: {
        zones: zones
          .filter((z) => z.active)
          .sort((a, b) => a.sort - b.sort)
          .map((z) => ({
            key: z.key,
            carrier: z.carrier,
            name: z.name,
            etaLabel: z.etaLabel,
            priceSoum: z.priceSoum,
            freeFromSoum: z.freeFromSoum,
            promiseHours: z.rule.promiseHours,
            cutoff: z.rule.cutoff ?? null,
            rule: z.rule,
          })),
        codMaxSoum: rules.codMaxSoum,
      },
      seo,
      returns: { returnDays: returns.returnDays },
      flags,
      // The widget only works with the bot whose token verifies it — not `store.telegramBot`.
      auth: { telegramBot: telegram?.botUsername ?? null },
    };
  }
}
