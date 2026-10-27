import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type IntegrationCardDto,
  type IntegrationDetailDto,
  type IntegrationLogDto,
  type IntegrationsHubDto,
  type IntegrationStatusKey,
  type IntegrationTestResultDto,
  type IntegrationWebhookDto,
} from '@forest/contracts';
import { redact } from '../../common/redact';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { IntegrationsService, type IntegrationView } from '../../integrations/integrations.service';
import { yandexCallbackUrl } from '../../integrations/providers/yandex-delivery';
import { getDefinition, type IntegrationDefinition } from '../../integrations/registry';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

/** Integrations with their own admin page (owned by that page; the hub only links). */
const DEDICATED_PAGES: Record<string, string> = { moysklad: '/moysklad' };

/** Inbound routes that exist; secret ones carry a credential in the URL (reveal = Owner + audit). */
const WEBHOOKS: Record<string, { secret: boolean; automatic: boolean; subpaths?: string[] }> = {
  payme: { secret: false, automatic: false },
  click: { secret: false, automatic: false, subpaths: ['/prepare', '/complete'] },
  eskiz: { secret: true, automatic: true },
  yandex_delivery: { secret: true, automatic: true },
};

const LOG_LIMIT = 20;
/** Seed placeholder IKPU (CLAUDE.md §6): counts as missing. */
const IKPU_PLACEHOLDER = '00000000000000000';

type Readiness = Pick<IntegrationCardDto, 'ready' | 'readyNote'>;

/**
 * Admin A10 over the existing `IntegrationsService` (registry, encrypted credentials, health
 * checks). Never returns a secret: fields come masked from `IntegrationsService.list()`.
 */
@Injectable()
export class AdminIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private apiBase(): string {
    return this.env.API_URL.replace(/\/+$/, '');
  }

  /** Active variants of active products without a real 17-digit IKPU. */
  private async ikpuMissing(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p.status = 'ACTIVE' AND v.active
        AND (v.ikpu IS NULL OR v.ikpu !~ '^[0-9]{17}$' OR v.ikpu = ${IKPU_PLACEHOLDER})`;
    return row?.n ?? 0;
  }

  private async readinessRules(): Promise<(view: IntegrationView) => Readiness> {
    const [flags, ikpuMissing] = await Promise.all([
      this.settings.get('flags'),
      this.ikpuMissing(),
    ]);
    return (view) => {
      const key = view.definition.key;
      if (key === 'cod')
        return { ready: flags.cod, readyNote: { kind: 'cod', enabled: flags.cod } };
      if (key === 'ikpu')
        return { ready: ikpuMissing === 0, readyNote: { kind: 'ikpu', missing: ikpuMissing } };
      // BTS has no partner API yet: manual mode (operator enters waybills) is the working setup.
      if (key === 'bts')
        return view.status === 'CONNECTED'
          ? { ready: true, readyNote: null }
          : { ready: true, readyNote: { kind: 'manual' } };
      return { ready: view.status === 'CONNECTED', readyNote: null };
    };
  }

  private card(view: IntegrationView, readiness: Readiness): IntegrationCardDto {
    const d = view.definition;
    const dedicatedPage = DEDICATED_PAGES[d.key] ?? null;
    return {
      key: d.key,
      name: d.name,
      category: d.category,
      description: d.description,
      mark: d.mark ?? null,
      icon: d.icon ?? null,
      status: view.status,
      launchKit: d.launchKit,
      ready: readiness.ready,
      readyNote: readiness.readyNote,
      availability: d.availability,
      implemented: d.implemented,
      connectable: d.availability === 'available' && d.fields.length > 0 && !dedicatedPage,
      dedicatedPage,
      lastCheckAt: view.lastCheckAt?.toISOString() ?? null,
      lastError: view.lastError,
    };
  }

  async hub(): Promise<IntegrationsHubDto> {
    const [views, rule] = await Promise.all([this.integrations.list(), this.readinessRules()]);
    const items = views.map((v) => this.card(v, rule(v)));
    const kit = items.filter((i) => i.launchKit);
    return {
      items,
      connected: items.filter((i) => i.status === 'CONNECTED').length,
      total: items.length,
      launchKit: { ready: kit.filter((i) => i.ready).length, total: kit.length },
      fakeMode: this.integrations.fakeMode,
    };
  }

  private definition(key: string): IntegrationDefinition {
    const def = getDefinition(key);
    if (!def) throw new DomainError('NOT_FOUND');
    return def;
  }

  private webhook(def: IntegrationDefinition): IntegrationWebhookDto | null {
    const spec = WEBHOOKS[def.key];
    if (!spec || !def.webhookPath) return null;
    const url = `${this.apiBase()}${def.webhookPath}`;
    return {
      url: spec.secret ? null : url,
      urls: spec.secret ? [] : (spec.subpaths ?? []).map((p) => `${url}${p}`),
      secret: spec.secret,
      automatic: spec.automatic,
    };
  }

  async detail(key: string): Promise<IntegrationDetailDto> {
    const def = this.definition(key);
    const [views, rule, logs] = await Promise.all([
      this.integrations.list(),
      this.readinessRules(),
      this.prisma.integrationLog.findMany({
        where: { integrationKey: key },
        orderBy: { createdAt: 'desc' },
        take: LOG_LIMIT,
      }),
    ]);
    const view = views.find((v) => v.definition.key === key);
    if (!view) throw new DomainError('NOT_FOUND');
    return {
      ...this.card(view, rule(view)),
      fields: def.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options ?? null,
        value: view.fields[f.key] ?? null,
      })),
      docsUrl: def.docsUrl ?? null,
      webhook: this.webhook(def),
      logs: logs.map((l): IntegrationLogDto => ({
        id: l.id,
        at: l.createdAt.toISOString(),
        direction: l.direction,
        kind: l.kind,
        ok: l.ok,
        message: redact(l.message),
        payload: l.payload === null ? null : redact(l.payload),
      })),
    };
  }

  /**
   * Owner: save credentials (blank secret = keep stored) and run the health check. The audit row
   * is written by `IntegrationsService.connect` inside its own transaction.
   */
  async connect(
    actor: AuditActor,
    key: string,
    input: Record<string, string>,
  ): Promise<IntegrationTestResultDto> {
    const def = this.definition(key);
    if (def.availability !== 'available' || def.fields.length === 0 || DEDICATED_PAGES[key])
      throw new DomainError('INTEGRATION_NOT_CONNECTABLE');
    const allowed = new Map(def.fields.map((f) => [f.key, f]));
    for (const [field, value] of Object.entries(input)) {
      const f = allowed.get(field);
      if (!f) throw new DomainError('VALIDATION_FAILED', { unknown: field }, field);
      const v = value.trim();
      if (f.type === 'select' && v !== '' && !f.options?.includes(v))
        throw new DomainError('VALIDATION_FAILED', { options: f.options }, field);
      if (f.type !== 'textarea' && f.type !== 'secret' && v.length > 500)
        throw new DomainError('VALIDATION_FAILED', { max: 500 }, field);
    }
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    const health = await this.integrations.connect(key, input, actor.staffId, actor.ip);
    actor.audited = true;
    const row = await this.prisma.integration.findUnique({ where: { key } });
    return {
      ok: health.ok,
      message: redact(health.message),
      status: (row?.status ?? 'DISCONNECTED') as IntegrationStatusKey,
      checkedAt: (row?.lastCheckAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Health check with the stored credentials. Records the result; promotes ERROR → CONNECTED but
   * never demotes CONNECTED (a transient outage must not switch off webhook authentication).
   */
  async test(actor: AuditActor, key: string): Promise<IntegrationTestResultDto> {
    this.definition(key);
    const row = await this.prisma.integration.findUnique({ where: { key } });
    if (!row?.credentials || (row.status !== 'CONNECTED' && row.status !== 'ERROR'))
      throw new DomainError('INTEGRATION_NOT_CONFIGURED', { integration: key });
    const health = await this.integrations.test(key);
    const message = redact(health.message).slice(0, 500);
    const checkedAt = new Date();
    const status: IntegrationStatusKey =
      row.status === 'ERROR' && health.ok ? 'CONNECTED' : (row.status as IntegrationStatusKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.integration.update({
        where: { key },
        data: { status, lastCheckAt: checkedAt, lastError: health.ok ? null : message },
      });
      await tx.integrationLog.create({
        data: {
          integrationKey: key,
          direction: 'OUT',
          kind: 'health.check',
          ok: health.ok,
          message,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'integration.test',
          entity: 'Integration',
          entityId: key,
          after: { ok: health.ok, status },
        },
        tx,
      );
    });
    return { ok: health.ok, message, status, checkedAt: checkedAt.toISOString() };
  }

  /** Owner: drop the stored credentials (typed confirmation = the integration key). */
  async disconnect(actor: AuditActor, key: string, confirm: string): Promise<void> {
    const def = this.definition(key);
    if (DEDICATED_PAGES[key]) throw new DomainError('INTEGRATION_NOT_CONNECTABLE');
    if (confirm !== def.key)
      throw new DomainError('ADMIN_CONFIRM_MISMATCH', { expected: def.key }, 'confirm');
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    await this.integrations.disconnect(key, actor.staffId, actor.ip);
    actor.audited = true;
  }

  /** Owner: callback URL that embeds a secret (Eskiz token path, Yandex `key`), audited. */
  async revealWebhookUrl(actor: AuditActor, key: string): Promise<{ url: string }> {
    const def = this.definition(key);
    const spec = WEBHOOKS[key];
    if (!spec?.secret || !def.webhookPath) throw new DomainError('NOT_FOUND');
    let url: string;
    if (key === 'eskiz') {
      const creds = await this.integrations.connectedCredentials('eskiz');
      if (!creds?.callbackToken)
        throw new DomainError('INTEGRATION_NOT_CONFIGURED', { integration: key });
      url = `${this.apiBase()}${def.webhookPath}/${creds.callbackToken}`;
    } else {
      url = yandexCallbackUrl(this.env.API_URL, this.env.APP_ENCRYPTION_KEY).replace(/&$/, '');
    }
    return this.audit.reveal(
      actor,
      {
        entity: 'Integration',
        entityId: key,
        fields: ['webhookUrl'],
        action: 'integration.view_secret',
      },
      async () => ({ url }),
    );
  }
}
