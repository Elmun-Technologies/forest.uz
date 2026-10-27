import { Inject, Injectable } from '@nestjs/common';
import { type MoyskladSettings, parseMoyskladSettings } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import type { InventoryMapping } from '../integrations/providers/types';
import { PrismaService } from '../prisma/prisma.service';

export const MOYSKLAD_KEY = 'moysklad';

export interface MoyskladState {
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastError: string | null;
  settings: MoyskladSettings;
}

export function mappingOf(settings: MoyskladSettings): InventoryMapping {
  return { priceType: settings.priceType, ikpuAttribute: settings.ikpuAttribute };
}

/** Webhook path for a token; the secret segment is what MoySklad must call. */
export function moyskladWebhookUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/webhooks/moysklad/${token}`;
}

/**
 * MoySklad settings in `Integration.config` (CLAUDE.md §6). Reads are lenient (defaults for missing
 * or bad values); writes store the complete parsed object.
 */
@Injectable()
export class MoyskladSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async state(
    db: Pick<Prisma.TransactionClient, 'integration'> = this.prisma,
  ): Promise<MoyskladState> {
    const row = await db.integration.findUnique({
      where: { key: MOYSKLAD_KEY },
      select: { status: true, config: true, lastError: true },
    });
    return {
      status: (row?.status as MoyskladState['status'] | undefined) ?? 'DISCONNECTED',
      lastError: row?.lastError ?? null,
      settings: parseMoyskladSettings(row?.config),
    };
  }

  /**
   * Whether sync work may run: scheduled jobs need a CONNECTED integration; a manual "sync now"
   * also runs in fake mode (dev/e2e: the fake provider answers).
   */
  async runnable(manual: boolean): Promise<MoyskladState | null> {
    const s = await this.state();
    if (s.status === 'CONNECTED') return s;
    return manual && this.integrations.fakeMode ? s : null;
  }

  async save(
    settings: MoyskladSettings,
    db: Pick<Prisma.TransactionClient, 'integration'> = this.prisma,
  ): Promise<void> {
    const config = settings as unknown as Prisma.InputJsonValue;
    await db.integration.upsert({
      where: { key: MOYSKLAD_KEY },
      update: { config },
      create: { key: MOYSKLAD_KEY, config },
    });
  }

  /**
   * Orders created before the orders flow was first switched on are never pushed: the first sync
   * after connecting starts the clock instead of exporting the shop's history.
   */
  async ensurePushSince(settings: MoyskladSettings, now = new Date()): Promise<MoyskladSettings> {
    if (settings.pushSince || !settings.flows.orders) return settings;
    const next = { ...settings, pushSince: now.toISOString() };
    await this.save(next);
    return next;
  }

  /** The webhook secret from the encrypted credentials of a CONNECTED integration. */
  async webhookToken(): Promise<string | null> {
    const c = await this.integrations.connectedCredentials(MOYSKLAD_KEY);
    return c?.webhookToken || null;
  }

  async webhookUrl(): Promise<string | null> {
    const token = await this.webhookToken();
    return token ? moyskladWebhookUrl(this.env.API_URL, token) : null;
  }

  get apiUrl(): string {
    return this.env.API_URL;
  }
}
