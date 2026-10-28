import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_TAB_STATUSES,
  formatSoum,
  formatTashkentHm,
  SLA_RISK_WINDOW_MS,
} from '@forest/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { html } from './bot-copy';
import { TelegramGateway } from './telegram-gateway.service';

export type BotAlertKind =
  'order_new' | 'payment_failed' | 'sla_risk' | 'review_low' | 'complaint' | 'integration_error';

const DEDUPE_SEC = 7 * 24 * 3600;
/** One integration error alert per integration per hour. */
const INTEGRATION_ERROR_EVERY_SEC = 3600;
const SCAN_WINDOW_MS = 15 * 60_000;

/**
 * Admin alerts group (docs/09, integration field `adminChatId`; CLAUDE.md §6 5A). Fire-and-forget:
 * never throws and never blocks the caller; each event is sent once (Redis dedupe key). Texts carry
 * no PII (order numbers, totals, regions, admin links).
 */
@Injectable()
export class BotAlertsService {
  private readonly logger = new Logger('BotAlerts');

  constructor(
    private readonly gateway: TelegramGateway,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Sends `text` (HTML) once per (kind, key). Returns whether it was sent now. */
  async alert(
    kind: BotAlertKind,
    key: string,
    text: string,
    ttlSec = DEDUPE_SEC,
  ): Promise<boolean> {
    try {
      const ctx = await this.gateway.api();
      const chat = ctx?.config.adminChatId;
      if (!ctx || !chat) return false;
      const fresh = await this.redis.set(`bot:alert:${kind}:${key}`, '1', 'EX', ttlSec, 'NX');
      if (fresh !== 'OK') return false;
      await ctx.api.sendMessage(chat, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return true;
    } catch (e) {
      this.logger.warn(`alert ${kind} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private admin(path: string): string {
    return `${this.env.ADMIN_URL.replace(/\/+$/, '')}${path}`;
  }

  /** New order (checkout after commit). */
  orderCreated(orderId: string): void {
    void this.run(async () => {
      const o = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          number: true,
          totalTiyin: true,
          paymentMethod: true,
          address: true,
          source: true,
        },
      });
      if (!o) return;
      const region = (o.address as { region?: string } | null)?.region ?? '';
      await this.alert(
        'order_new',
        orderId,
        [
          `<b>Yangi buyurtma ${html(o.number)}</b>`,
          `${html(formatSoum(o.totalTiyin))} · ${o.paymentMethod}${region ? ` · ${html(region)}` : ''}${o.source !== 'web' ? ` · ${html(o.source)}` : ''}`,
          this.admin(`/orders/${encodeURIComponent(o.number)}`),
        ].join('\n'),
      );
    });
  }

  /** Never rejects; the bot awaits it so the alert is out before the webhook answers. */
  async reviewLow(reviewId: string, rating: number, orderNumber: string): Promise<void> {
    await this.alert(
      'review_low',
      reviewId,
      [`<b>Past baho: ${rating}★</b> · buyurtma ${html(orderNumber)}`, this.admin('/reviews')].join(
        '\n',
      ),
    );
  }

  async complaint(conversationId: string, preview: string): Promise<void> {
    await this.alert(
      'complaint',
      // One alert per conversation episode (a later complaint after closing alerts again).
      conversationId,
      [
        '<b>Shikoyat (Telegram bot)</b>',
        html(preview.slice(0, 200)),
        this.admin(`/bot/inbox?c=${encodeURIComponent(conversationId)}`),
      ].join('\n'),
    );
  }

  /**
   * Job `bot.alerts.scan` (every minute): failed payments and SLA risk from the DB, integration
   * errors from Integration/IntegrationLog — sources without a single after-commit hook.
   */
  async scan(now = new Date()): Promise<number> {
    const ctx = await this.gateway.api();
    if (!ctx?.config.adminChatId) return 0;
    let sent = 0;
    const since = new Date(now.getTime() - SCAN_WINDOW_MS);
    const failed = await this.prisma.payment.findMany({
      where: { status: 'FAILED', updatedAt: { gte: since } },
      select: { id: true, method: true, amountTiyin: true, order: { select: { number: true } } },
      take: 50,
    });
    for (const p of failed)
      if (
        await this.alert(
          'payment_failed',
          p.id,
          [
            `<b>To'lov o'tmadi</b> · ${html(p.order.number)} · ${p.method} · ${html(formatSoum(p.amountTiyin))}`,
            this.admin(`/orders/${encodeURIComponent(p.order.number)}`),
          ].join('\n'),
        )
      )
        sent++;

    const risky = await this.prisma.order.findMany({
      where: {
        status: { in: [...ADMIN_TAB_STATUSES.sla_risk] },
        slaDueAt: { lt: new Date(now.getTime() + SLA_RISK_WINDOW_MS) },
      },
      select: { id: true, number: true, slaDueAt: true, status: true },
      orderBy: { slaDueAt: 'asc' },
      take: 50,
    });
    for (const o of risky) {
      const overdue = o.slaDueAt! < now;
      if (
        await this.alert(
          'sla_risk',
          // A second alert once the promise is actually missed.
          `${o.id}:${overdue ? 'overdue' : 'risk'}`,
          [
            `<b>${overdue ? 'SLA buzildi' : 'SLA xavfi'}</b> · ${html(o.number)} · ${o.status} · muddat ${formatTashkentHm(o.slaDueAt!)}`,
            this.admin(`/orders/${encodeURIComponent(o.number)}`),
          ].join('\n'),
        )
      )
        sent++;
    }

    const integrations = await this.prisma.integration.findMany({
      select: { key: true, status: true, lastError: true },
    });
    for (const i of integrations) {
      const log =
        i.status === 'ERROR'
          ? null
          : await this.prisma.integrationLog.findFirst({
              where: { integrationKey: i.key, ok: false, createdAt: { gte: since } },
              orderBy: { createdAt: 'desc' },
              select: { kind: true, message: true },
            });
      if (i.status !== 'ERROR' && !log) continue;
      const message = log ? `${log.kind}: ${log.message}` : (i.lastError ?? 'ERROR');
      if (
        await this.alert(
          'integration_error',
          i.key,
          [
            `<b>Integratsiya xatosi: ${html(i.key)}</b>`,
            html(message.slice(0, 300)),
            this.admin('/integrations'),
          ].join('\n'),
          INTEGRATION_ERROR_EVERY_SEC,
        )
      )
        sent++;
    }
    return sent;
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`alert failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
