import { Injectable, Logger } from '@nestjs/common';
import { type WebhookEvent, WEBHOOK_POLICY } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  customerData,
  orderData,
  orderEventsFor,
  type OrderForWebhook,
  reviewData,
} from './payloads';

const CURSOR = 'webhooks.collect';
const PER_SOURCE = 1000;

interface SourceEvent {
  key: string;
  event: WebhookEvent;
  at: Date;
  data: unknown;
}

/**
 * Turns committed rows into webhook deliveries (CLAUDE.md §6): OrderEvent, Customer and the review
 * moderation audit rows after a `JobCursor`, re-reading a lookback window so a transaction that
 * commits late is not missed; `(endpointId, eventKey)` is unique, so re-reads insert nothing.
 */
@Injectable()
export class WebhookCollector {
  private readonly logger = new Logger('WebhookCollector');

  constructor(private readonly prisma: PrismaService) {}

  async collect(now = new Date()): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { active: true },
      select: { id: true, events: true, createdAt: true },
    });
    const cursor = await this.prisma.jobCursor.findUnique({ where: { key: CURSOR } });
    const lookback = WEBHOOK_POLICY.lookbackSec * 1000;
    // After a capped run continue from its last row; otherwise re-read the lookback window.
    const resume = cursor?.ref === 'capped';
    const from = new Date((cursor?.ts.getTime() ?? now.getTime()) - (resume ? 0 : lookback));
    if (endpoints.length === 0) {
      await this.saveCursor(now, false);
      return 0;
    }
    const range = resume ? { gte: from, lte: now } : { gt: from, lte: now };
    const [orderEvents, customers, approvals] = await Promise.all([
      this.prisma.orderEvent.findMany({
        where: { createdAt: range, type: { in: ['CREATED', 'PAYMENT_PAID', 'STATUS_CHANGED'] } },
        orderBy: { createdAt: 'asc' },
        take: PER_SOURCE,
        select: { id: true, orderId: true, type: true, from: true, to: true, createdAt: true },
      }),
      this.prisma.customer.findMany({
        where: { createdAt: range, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: PER_SOURCE,
        select: { id: true, publicId: true, locale: true, leadSource: true, createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          createdAt: range,
          action: 'review.moderate',
          after: { path: ['status'], equals: 'APPROVED' },
        },
        orderBy: { createdAt: 'asc' },
        take: PER_SOURCE,
        select: { id: true, entityId: true, createdAt: true },
      }),
    ]);

    const events: SourceEvent[] = [];
    const orders = await this.orders([...new Set(orderEvents.map((e) => e.orderId))]);
    for (const e of orderEvents) {
      const order = orders.get(e.orderId);
      if (!order) continue;
      for (const event of orderEventsFor(e))
        events.push({
          key: `OrderEvent:${e.id}:${event}`,
          event,
          at: e.createdAt,
          data: orderData(
            order,
            event === 'order.status_changed' ? { from: e.from, to: e.to } : undefined,
          ),
        });
    }
    for (const c of customers)
      events.push({
        key: `Customer:${c.id}`,
        event: 'customer.created',
        at: c.createdAt,
        data: customerData(c),
      });
    const reviewIds = approvals.map((a) => a.entityId).filter((id): id is string => !!id);
    const reviews = new Map(
      (
        await this.prisma.review.findMany({
          where: { id: { in: reviewIds }, status: 'APPROVED' },
          include: { product: { select: { slug: true } } },
        })
      ).map((r) => [r.id, r]),
    );
    for (const a of approvals) {
      const r = a.entityId ? reviews.get(a.entityId) : undefined;
      if (r)
        events.push({
          key: `AuditLog:${a.id}`,
          event: 'review.approved',
          at: a.createdAt,
          data: reviewData(r),
        });
    }

    const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const ev of events)
      for (const ep of endpoints)
        if (ep.events.includes(ev.event) && ep.createdAt <= ev.at)
          rows.push({
            endpointId: ep.id,
            event: ev.event,
            eventKey: ev.key,
            payload: ev.data as Prisma.InputJsonValue,
          });
    let created = 0;
    for (let i = 0; i < rows.length; i += 500)
      created += (
        await this.prisma.webhookDelivery.createMany({
          data: rows.slice(i, i + 500),
          skipDuplicates: true,
        })
      ).count;

    // A capped source stops the cursor at its last row, so the rest comes next run.
    const capped = [orderEvents, customers, approvals]
      .filter((list) => list.length === PER_SOURCE)
      .map((list) => list.at(-1)!.createdAt.getTime());
    await this.saveCursor(capped.length ? new Date(Math.min(...capped)) : now, capped.length > 0);
    if (created) this.logger.log(`${created} webhook deliveries queued`);
    return created;
  }

  private async orders(ids: string[]): Promise<Map<string, OrderForWebhook>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      include: { items: true, payments: { select: { status: true, createdAt: true } } },
    });
    return new Map(rows.map((o) => [o.id, o]));
  }

  private async saveCursor(ts: Date, capped: boolean): Promise<void> {
    const ref = capped ? 'capped' : '';
    await this.prisma.jobCursor.upsert({
      where: { key: CURSOR },
      update: { ts, ref },
      create: { key: CURSOR, ts, ref },
    });
  }
}
