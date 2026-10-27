import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type WebhookEnvelope,
  type WebhookEvent,
  webhookRetryDelaySec,
  WEBHOOK_POLICY,
  WEBHOOK_TEST_EVENT,
} from '@forest/contracts';
import type { WebhookDelivery, WebhookEndpoint } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signWebhook } from './signature';
import { assertWebhookUrl } from './url-guard';
import { WebhookSecrets } from './webhook-secrets';

/** IntegrationLog key for outbound webhook attempts (not a registry card). */
export const WEBHOOKS_LOG_KEY = 'webhooks';
const USER_AGENT = 'Forest-Webhooks/1.0';

export interface AttemptResult {
  ok: boolean;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
}

/**
 * Sends due deliveries (CLAUDE.md §6): signed POST, 2xx = delivered, otherwise retried by the
 * backoff table; the 8th failure makes the delivery FAILED and counts towards auto-disable.
 * No HTTP inside a transaction: the row is leased first, results are written afterwards.
 */
@Injectable()
export class WebhookSender {
  private readonly logger = new Logger('WebhookSender');

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: WebhookSecrets,
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get strictUrls(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** Claims due rows (lease) and attempts each once. */
  async sendDue(): Promise<number> {
    const lease = `${WEBHOOK_POLICY.leaseSec} seconds`;
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "WebhookDelivery" SET "nextAttemptAt" = now() + ${lease}::interval
      WHERE "id" IN (
        SELECT d."id" FROM "WebhookDelivery" d
        JOIN "WebhookEndpoint" e ON e."id" = d."endpointId"
        WHERE d."status" = 'PENDING' AND d."nextAttemptAt" <= now() AND e."active"
        ORDER BY d."nextAttemptAt" LIMIT ${WEBHOOK_POLICY.batch}
        FOR UPDATE OF d SKIP LOCKED)
      RETURNING "id"`;
    for (const { id } of claimed) {
      try {
        await this.attempt(id);
      } catch (e) {
        this.logger.error(`delivery ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return claimed.length;
  }

  /**
   * One attempt. `single` (send test): no retries — the result is final and doesn't count
   * towards auto-disable.
   */
  async attempt(id: string, opts: { single?: boolean } = {}): Promise<AttemptResult> {
    const d = await this.prisma.webhookDelivery.findUnique({
      where: { id },
      include: { endpoint: true },
    });
    if (!d || d.status !== 'PENDING')
      return { ok: false, statusCode: null, durationMs: null, error: 'not pending' };
    const result = await this.post(d, d.endpoint);
    await this.record(d, d.endpoint, result, opts.single ?? false);
    return result;
  }

  private async post(d: WebhookDelivery, endpoint: WebhookEndpoint): Promise<AttemptResult> {
    const started = Date.now();
    try {
      const url = await assertWebhookUrl(endpoint.url, { strict: this.strictUrls });
      const envelope: WebhookEnvelope = {
        id: d.id,
        type: d.event as WebhookEvent | typeof WEBHOOK_TEST_EVENT,
        createdAt: d.createdAt.toISOString(),
        data: d.payload,
      };
      const body = JSON.stringify(envelope);
      const secret = this.secrets.open(endpoint.id, endpoint.secret);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          [EVENT_HEADER]: d.event,
          [DELIVERY_HEADER]: d.id,
          [SIGNATURE_HEADER]: signWebhook(secret, body),
        },
        body,
        // A redirect could point at an internal host the URL check never saw.
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_POLICY.timeoutMs),
      });
      // The body is never read beyond what undici needs to free the socket.
      await res.body?.cancel().catch(() => undefined);
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        statusCode: res.status,
        durationMs: Date.now() - started,
        error: ok ? null : `HTTP ${res.status}`,
      };
    } catch (e) {
      const error =
        e instanceof Error
          ? e.name === 'TimeoutError'
            ? 'timeout'
            : 'code' in e && e.code === 'WEBHOOK_URL_INVALID'
              ? 'url not allowed'
              : e.message
          : String(e);
      return {
        ok: false,
        statusCode: null,
        durationMs: Date.now() - started,
        error: error.slice(0, 300),
      };
    }
  }

  private async record(
    d: WebhookDelivery,
    endpoint: WebhookEndpoint,
    r: AttemptResult,
    single: boolean,
  ): Promise<void> {
    const attempts = d.attempts + 1;
    const now = new Date();
    const delay = r.ok || single ? null : webhookRetryDelaySec(attempts);
    const status = r.ok ? 'DELIVERED' : delay === null ? 'FAILED' : 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          status,
          lastAttemptAt: now,
          lastStatusCode: r.statusCode,
          lastError: r.error,
          durationMs: r.durationMs,
          deliveredAt: r.ok ? now : null,
          nextAttemptAt: delay === null ? null : new Date(now.getTime() + delay * 1000),
        },
      });
      if (single) return;
      if (r.ok) {
        if (endpoint.consecutiveFailures > 0)
          await tx.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { consecutiveFailures: 0 },
          });
        return;
      }
      if (status !== 'FAILED') return;
      const ep = await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { consecutiveFailures: { increment: 1 } },
      });
      if (ep.active && ep.consecutiveFailures >= WEBHOOK_POLICY.autoDisableAfter) {
        const reason = `${ep.consecutiveFailures} failed deliveries in a row`;
        await tx.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { active: false, disabledAt: now, disabledReason: reason },
        });
        await tx.auditLog.create({
          data: {
            staffId: null,
            action: 'webhook.auto_disabled',
            entity: 'WebhookEndpoint',
            entityId: endpoint.id,
            after: { reason, failures: ep.consecutiveFailures },
          },
        });
        this.logger.warn(`webhook endpoint ${endpoint.id} disabled: ${reason}`);
      }
    });
    await this.integrations
      .log(WEBHOOKS_LOG_KEY, {
        direction: 'OUT',
        kind: `webhook.${d.event}`,
        ok: r.ok,
        message: `${endpoint.id} attempt ${attempts}: ${r.ok ? `HTTP ${r.statusCode}` : r.error} (${r.durationMs ?? 0} ms)`,
      })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}
