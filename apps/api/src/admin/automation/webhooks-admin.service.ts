import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  isWebhookEvent,
  type WebhookCreateInput,
  type WebhookDeliveriesQuery,
  type WebhookDeliveryDto,
  type WebhookDeliveryPageDto,
  type WebhookDeliveryStatus,
  type WebhookEndpointDto,
  WEBHOOK_EVENTS,
  WEBHOOK_POLICY,
  WEBHOOK_TEST_EVENT,
  type WebhookListDto,
  type WebhookSecretDto,
  type WebhookTestResultDto,
  type WebhookUpdateInput,
} from '@forest/contracts';
import type { Prisma, WebhookDelivery, WebhookEndpoint } from '@forest/db';
import { randomBytes } from 'node:crypto';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookSender } from '../../webhooks-out/sender.service';
import { maskWebhookSecret, newWebhookSecret } from '../../webhooks-out/signature';
import { assertWebhookUrl } from '../../webhooks-out/url-guard';
import { WebhookSecrets } from '../../webhooks-out/webhook-secrets';
import { type AuditActor, AuditService } from '../audit/audit.service';

type Stats = WebhookEndpointDto['stats24h'];

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Audit view of an endpoint: never the secret. */
const auditView = (e: Pick<WebhookEndpoint, 'name' | 'url' | 'events' | 'active'>) => ({
  name: e.name,
  url: e.url,
  events: e.events,
  active: e.active,
});

/**
 * Admin outbound webhooks (A10, CLAUDE.md §6). Secrets are generated here, returned once and
 * stored sealed; every change is audited without them.
 */
@Injectable()
export class WebhooksAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secrets: WebhookSecrets,
    private readonly sender: WebhookSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private url(raw: string): Promise<string> {
    return assertWebhookUrl(raw, { strict: this.env.NODE_ENV === 'production' });
  }

  private dto(e: WebhookEndpoint, stats: Stats): WebhookEndpointDto {
    return {
      id: e.id,
      name: e.name,
      url: e.url,
      host: hostOf(e.url),
      events: e.events.filter(isWebhookEvent),
      active: e.active,
      disabledAt: e.disabledAt?.toISOString() ?? null,
      disabledReason: e.disabledReason,
      consecutiveFailures: e.consecutiveFailures,
      secretMasked: maskWebhookSecret(e.secretLast4),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      stats24h: stats,
    };
  }

  private deliveryDto(d: WebhookDelivery): WebhookDeliveryDto {
    return {
      id: d.id,
      event: d.event,
      status: d.status as WebhookDeliveryStatus,
      attempts: d.attempts,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      durationMs: d.durationMs,
      nextAttemptAt: d.status === 'PENDING' ? (d.nextAttemptAt?.toISOString() ?? null) : null,
      lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  /** Delivered/failed by completion time, pending by creation, within the last 24 h. */
  private async stats(
    ids: string[],
  ): Promise<Map<string, Stats & { byEvent: Map<string, number> }>> {
    const since = new Date(Date.now() - 86_400_000);
    const rows = ids.length
      ? await this.prisma.$queryRaw<
          { endpointId: string; event: string; status: string; n: number }[]
        >`
          SELECT "endpointId", "event", "status", COUNT(*)::int AS n FROM "WebhookDelivery"
          WHERE "endpointId" = ANY(${ids}) AND "event" <> ${WEBHOOK_TEST_EVENT}
            AND COALESCE("deliveredAt", "lastAttemptAt", "createdAt") >= ${since}
          GROUP BY 1, 2, 3`
      : [];
    const out = new Map<string, Stats & { byEvent: Map<string, number> }>();
    for (const id of ids) out.set(id, { delivered: 0, failed: 0, pending: 0, byEvent: new Map() });
    for (const r of rows) {
      const s = out.get(r.endpointId)!;
      if (r.status === 'DELIVERED') {
        s.delivered += r.n;
        s.byEvent.set(r.event, (s.byEvent.get(r.event) ?? 0) + r.n);
      } else if (r.status === 'FAILED') s.failed += r.n;
      else s.pending += r.n;
    }
    return out;
  }

  async list(): Promise<WebhookListDto> {
    const rows = await this.prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' } });
    const stats = await this.stats(rows.map((r) => r.id));
    const items = rows.map((r) => {
      const { byEvent: _byEvent, ...s } = stats.get(r.id)!;
      return this.dto(r, s);
    });
    const byEvent = WEBHOOK_EVENTS.flatMap((event) => {
      const subs = rows.filter((r) => r.events.includes(event));
      if (!subs.length) return [];
      return [
        {
          event,
          destinations: subs.map((r) => r.name || hostOf(r.url)),
          delivered24h: subs.reduce((n, r) => n + (stats.get(r.id)!.byEvent.get(event) ?? 0), 0),
        },
      ];
    });
    return { items, events: [...WEBHOOK_EVENTS], byEvent };
  }

  private async get(id: string): Promise<WebhookEndpoint> {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!row) throw new DomainError('NOT_FOUND');
    return row;
  }

  private async one(id: string): Promise<WebhookEndpointDto> {
    const row = await this.get(id);
    const { byEvent: _byEvent, ...s } = (await this.stats([id])).get(id)!;
    return this.dto(row, s);
  }

  async create(actor: AuditActor, input: WebhookCreateInput): Promise<WebhookSecretDto> {
    const url = await this.url(input.url);
    const id = `wh${randomBytes(12).toString('hex')}`;
    const secret = newWebhookSecret();
    await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent creates so the endpoint cap can't be overshot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('webhook.create'))`;
      if ((await tx.webhookEndpoint.count()) >= WEBHOOK_POLICY.maxEndpoints)
        throw new DomainError('WEBHOOK_LIMIT');
      const row = await tx.webhookEndpoint.create({
        data: {
          id,
          name: input.name,
          url,
          events: input.events,
          secret: this.secrets.seal(id, secret),
          secretLast4: secret.slice(-4),
          createdById: actor.staffId,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'webhook.create',
          entity: 'WebhookEndpoint',
          entityId: id,
          after: auditView(row),
        },
        tx,
      );
    });
    return { endpoint: await this.one(id), secret };
  }

  async update(
    actor: AuditActor,
    id: string,
    input: WebhookUpdateInput,
  ): Promise<WebhookEndpointDto> {
    const url = input.url !== undefined ? await this.url(input.url) : undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WebhookEndpoint" WHERE "id" = ${id} FOR UPDATE`;
      const before = await tx.webhookEndpoint.findUnique({ where: { id } });
      if (!before) throw new DomainError('NOT_FOUND');
      // Rows migrated from the pre-Phase-5 shape have no sealed secret yet: rotate first.
      if (input.active === true && !before.secretLast4)
        throw new DomainError('VALIDATION_FAILED', { rotateSecret: true }, 'active');
      const data: Prisma.WebhookEndpointUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        // Switching back on is a fresh start (auto-disable counter and reason cleared).
        ...(input.active === true && !before.active
          ? { disabledAt: null, disabledReason: null, consecutiveFailures: 0 }
          : {}),
      };
      const after = await tx.webhookEndpoint.update({ where: { id }, data });
      await this.audit.record(
        actor,
        {
          action: 'webhook.update',
          entity: 'WebhookEndpoint',
          entityId: id,
          before: auditView(before),
          after: auditView(after),
        },
        tx,
      );
    });
    return this.one(id);
  }

  async rotateSecret(actor: AuditActor, id: string): Promise<WebhookSecretDto> {
    const secret = newWebhookSecret();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WebhookEndpoint" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.webhookEndpoint.findUnique({ where: { id } });
      if (!row) throw new DomainError('NOT_FOUND');
      await tx.webhookEndpoint.update({
        where: { id },
        data: { secret: this.secrets.seal(id, secret), secretLast4: secret.slice(-4) },
      });
      await this.audit.record(
        actor,
        { action: 'webhook.rotate_secret', entity: 'WebhookEndpoint', entityId: id },
        tx,
      );
    });
    return { endpoint: await this.one(id), secret };
  }

  async remove(actor: AuditActor, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.webhookEndpoint.findUnique({ where: { id } });
      if (!row) throw new DomainError('NOT_FOUND');
      await tx.webhookEndpoint.delete({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'webhook.delete',
          entity: 'WebhookEndpoint',
          entityId: id,
          before: auditView(row),
        },
        tx,
      );
    });
  }

  async deliveries(id: string, q: WebhookDeliveriesQuery): Promise<WebhookDeliveryPageDto> {
    await this.get(id);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        endpointId: id,
        ...(q.status ? { status: q.status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((d) => this.deliveryDto(d)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** "Send test": one signed delivery, sent now (no retries), result shown at once. */
  async test(actor: AuditActor, id: string): Promise<WebhookTestResultDto> {
    const endpoint = await this.get(id);
    const delivery = await this.prisma.$transaction(async (tx) => {
      const d = await tx.webhookDelivery.create({
        data: {
          endpointId: id,
          event: WEBHOOK_TEST_EVENT,
          eventKey: `test:${randomBytes(9).toString('hex')}`,
          payload: {
            message: 'Forest webhook test',
            endpoint: endpoint.name || hostOf(endpoint.url),
          },
          nextAttemptAt: null,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'webhook.test',
          entity: 'WebhookEndpoint',
          entityId: id,
          after: { deliveryId: d.id },
        },
        tx,
      );
      return d;
    });
    const r = await this.sender.attempt(delivery.id, { single: true });
    const row = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    return { ...r, delivery: this.deliveryDto(row) };
  }

  /** A FAILED delivery is queued again from attempt 1. */
  async redeliver(actor: AuditActor, id: string, deliveryId: string): Promise<WebhookDeliveryDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const d = await tx.webhookDelivery.findFirst({ where: { id: deliveryId, endpointId: id } });
      if (!d) throw new DomainError('NOT_FOUND');
      if (d.status !== 'FAILED' || d.event === WEBHOOK_TEST_EVENT)
        throw new DomainError('VALIDATION_FAILED', { status: d.status }, 'deliveryId');
      const next = await tx.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() },
      });
      await this.audit.record(
        actor,
        {
          action: 'webhook.redeliver',
          entity: 'WebhookEndpoint',
          entityId: id,
          after: { deliveryId, event: d.event },
        },
        tx,
      );
      return next;
    });
    return this.deliveryDto(row);
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(c: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime()))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { at, id };
}
