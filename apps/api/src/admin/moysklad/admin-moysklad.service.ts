import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type MoyskladLogPageDto,
  type MoyskladLogQuery,
  type MoyskladSettings,
  type MoyskladSettingsPatch,
  type MoyskladStatusDto,
  type MoyskladSyncScope,
  type MoyskladWebhooksResultDto,
  tashkentDayStart,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { maskSecret } from '../../integrations/crypto/secret-box';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MoyskladJobs } from '../../moysklad/moysklad-jobs.service';
import { MoyskladLogService } from '../../moysklad/moysklad-log.service';
import { MoyskladScheduler } from '../../moysklad/moysklad.module';
import {
  MOYSKLAD_KEY,
  MoyskladSettingsService,
  moyskladWebhookUrl,
} from '../../moysklad/moysklad-settings.service';
import { catalogLocks } from '../../moysklad/source-of-truth';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../products/cursor';

/** Applies an admin patch: flows/state map merge; switching orders on starts `pushSince`. */
export function mergeMoyskladSettings(
  current: MoyskladSettings,
  patch: MoyskladSettingsPatch,
  now: Date,
): MoyskladSettings {
  const next: MoyskladSettings = {
    ...current,
    ...(patch.priceType !== undefined ? { priceType: patch.priceType } : {}),
    ...(patch.storeId !== undefined ? { storeId: patch.storeId } : {}),
    ...(patch.organizationId !== undefined ? { organizationId: patch.organizationId } : {}),
    ...(patch.ikpuAttribute !== undefined ? { ikpuAttribute: patch.ikpuAttribute } : {}),
    ...(patch.deliveryAttribute !== undefined
      ? { deliveryAttribute: patch.deliveryAttribute }
      : {}),
    ...(patch.defaultCounterpartyId !== undefined
      ? { defaultCounterpartyId: patch.defaultCounterpartyId }
      : {}),
    ...(patch.reserve !== undefined ? { reserve: patch.reserve } : {}),
    ...(patch.stockPollMinutes !== undefined ? { stockPollMinutes: patch.stockPollMinutes } : {}),
    stateMap: { ...current.stateMap, ...patch.stateMap },
    flows: { ...current.flows, ...patch.flows },
  };
  // Orders placed while the flow was off are not exported later (history stays out of MoySklad).
  if (next.flows.orders && (!current.flows.orders || !current.pushSince))
    next.pushSince = now.toISOString();
  return next;
}

/** A13 MoySklad page: status/KPIs, settings, sync now, log, webhook URL. */
@Injectable()
export class AdminMoyskladService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: MoyskladSettingsService,
    private readonly jobs: MoyskladJobs,
    private readonly scheduler: MoyskladScheduler,
    private readonly log: MoyskladLogService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(now = new Date()): Promise<MoyskladStatusDto> {
    const state = await this.settings.state();
    const dayStart = tashkentDayStart(now);
    const [linkedSkus, totalSkus, ordersPushedToday, errors24h, ordersFailing, creds, locks] =
      await Promise.all([
        this.prisma.variant.count({ where: { active: true, moyskladId: { not: null } } }),
        this.prisma.variant.count({ where: { active: true } }),
        this.prisma.integrationLog.count({
          where: {
            integrationKey: MOYSKLAD_KEY,
            kind: 'order',
            ok: true,
            createdAt: { gte: dayStart },
          },
        }),
        this.prisma.integrationLog.count({
          where: {
            integrationKey: MOYSKLAD_KEY,
            ok: false,
            createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          },
        }),
        this.prisma.moyskladOrderLink.count({ where: { lastError: { not: null } } }),
        this.integrations.credentials(MOYSKLAD_KEY),
        catalogLocks(this.prisma),
      ]);
    const [catalog, stock, orders] = await Promise.all([
      this.log.lastSynced('catalog'),
      this.log.lastSynced('stock'),
      this.log.lastSynced('orders'),
    ]);
    const last = [catalog, stock, orders].filter((d): d is Date => d !== null);
    const token = creds.webhookToken;
    return {
      connection: state.status,
      usingFake: this.integrations.fakeMode,
      lastError: state.lastError,
      kpis: {
        lastSyncAt: last.length
          ? new Date(Math.max(...last.map((d) => d.getTime()))).toISOString()
          : null,
        lastStockSyncAt: stock?.toISOString() ?? null,
        linkedSkus,
        totalSkus,
        ordersPushedToday,
        errors24h,
        ordersFailing,
      },
      settings: state.settings,
      connectionInfo: {
        tokenMasked: maskSecret(creds.token),
        webhookUrlMasked: token
          ? moyskladWebhookUrl(this.env.API_URL, `••••${token.slice(-4)}`)
          : null,
      },
      sourceOfTruth: locks,
    };
  }

  async updateSettings(
    actor: AuditActor,
    patch: MoyskladSettingsPatch,
  ): Promise<MoyskladStatusDto> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "Integration" WHERE "key" = ${MOYSKLAD_KEY} FOR UPDATE`;
      const before = (await this.settings.state(tx)).settings;
      const after = mergeMoyskladSettings(before, patch, now);
      await this.settings.save(after, tx);
      await this.audit.record(
        actor,
        {
          action: 'moysklad.settings_update',
          entity: 'Integration',
          entityId: MOYSKLAD_KEY,
          before: changed(before, after, 'before'),
          after: changed(before, after, 'after'),
        },
        tx as Prisma.TransactionClient,
      );
    });
    if (patch.stockPollMinutes !== undefined) await this.scheduler.reschedule();
    return this.status(now);
  }

  async syncNow(actor: AuditActor, scope: MoyskladSyncScope): Promise<void> {
    await this.jobs.enqueueSyncNow(scope);
    await this.audit.record(actor, {
      action: 'moysklad.sync_now',
      entity: 'Integration',
      entityId: MOYSKLAD_KEY,
      after: { scope },
    });
  }

  async logPage(q: MoyskladLogQuery): Promise<MoyskladLogPageDto> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const where: Prisma.IntegrationLogWhereInput = {
      integrationKey: MOYSKLAD_KEY,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.ok ? { ok: q.ok === 'true' } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.integrationLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: { id: true, createdAt: true, kind: true, direction: true, ok: true, message: true },
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        kind: r.kind,
        direction: r.direction === 'OUT' ? 'OUT' : 'IN',
        ok: r.ok,
        message: r.message,
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Full webhook URL (secret path) for pasting into MoySklad — Owner only, audited. */
  async revealWebhookUrl(actor: AuditActor): Promise<string> {
    const url = await this.settings.webhookUrl();
    if (!url) throw new DomainError('MOYSKLAD_NOT_CONNECTED');
    await this.audit.record(actor, {
      action: 'moysklad.webhook_reveal',
      entity: 'Integration',
      entityId: MOYSKLAD_KEY,
    });
    return url;
  }

  /** Creates our product/variant/bundle + stock webhooks in MoySklad (idempotent). */
  async registerWebhooks(actor: AuditActor): Promise<MoyskladWebhooksResultDto> {
    const url = await this.settings.webhookUrl();
    if (!url) throw new DomainError('MOYSKLAD_NOT_CONNECTED');
    // MoySklad calls a public URL only; its `url` field holds at most 255 characters.
    if ((!url.startsWith('https://') && !this.integrations.fakeMode) || url.length > 255)
      throw new DomainError('MOYSKLAD_WEBHOOK_URL_UNAVAILABLE');
    const { settings } = await this.settings.state();
    let result: MoyskladWebhooksResultDto;
    try {
      const provider = await this.integrations.inventory();
      result = await provider.registerWebhooks(url, { byStore: Boolean(settings.storeId) });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      await this.log.log(
        'webhook',
        false,
        `Webhook ro'yxatdan o'tmadi: ${String(e).slice(0, 200)}`,
        {
          direction: 'OUT',
        },
      );
      throw new DomainError('MOYSKLAD_PROVIDER_ERROR');
    }
    await this.audit.record(actor, {
      action: 'moysklad.webhooks_register',
      entity: 'Integration',
      entityId: MOYSKLAD_KEY,
      after: result,
    });
    await this.log.log(
      'webhook',
      true,
      `Webhooklar: ${result.created} yangi, ${result.existing} avvaldan bor`,
      { direction: 'OUT' },
    );
    return result;
  }
}

/** Only the keys that changed, for a readable audit row. */
function changed(
  before: MoyskladSettings,
  after: MoyskladSettings,
  side: 'before' | 'after',
): Record<string, unknown> {
  const src = side === 'before' ? before : after;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof MoyskladSettings)[])
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = src[k];
  return out;
}
