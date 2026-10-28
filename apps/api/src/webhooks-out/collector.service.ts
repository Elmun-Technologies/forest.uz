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
const PAGE = 500;
/**
 * Rows per source per run. Only > MAX_ROWS rows inside one 2-minute lookback window could hold the
 * cursor back (orders of magnitude above this store's volume); nothing is ever skipped.
 */
const MAX_ROWS = 10_000;

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
    // Every run re-reads the lookback window behind the cursor (late commits); the window is
    // paged by (createdAt, id) so a busy window never stalls the cursor.
    const from = new Date(
      (cursor?.ts.getTime() ?? now.getTime()) - WEBHOOK_POLICY.lookbackSec * 1000,
    );
    if (endpoints.length === 0) {
      await this.saveCursor(now);
      return 0;
    }
    const range = { gt: from, lte: now };
    const [orderEvents, customers, approvals] = await Promise.all([
      paged((after) =>
        this.prisma.orderEvent.findMany({
          where: {
            AND: [{ createdAt: range }, after],
            type: { in: ['CREATED', 'PAYMENT_PAID', 'STATUS_CHANGED'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: PAGE,
          select: { id: true, orderId: true, type: true, from: true, to: true, createdAt: true },
        }),
      ),
      paged((after) =>
        this.prisma.customer.findMany({
          where: { AND: [{ createdAt: range }, after], deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: PAGE,
          select: { id: true, publicId: true, locale: true, leadSource: true, createdAt: true },
        }),
      ),
      paged((after) =>
        this.prisma.auditLog.findMany({
          where: {
            AND: [{ createdAt: range }, after],
            action: 'review.moderate',
            after: { path: ['status'], equals: 'APPROVED' },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: PAGE,
          select: { id: true, entityId: true, createdAt: true },
        }),
      ),
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

    // A source that hit MAX_ROWS stops the cursor at its last row; the rest comes next run.
    const capped = [orderEvents, customers, approvals]
      .filter((list) => list.length >= MAX_ROWS)
      .map((list) => list.at(-1)!.createdAt.getTime());
    await this.saveCursor(capped.length ? new Date(Math.min(...capped)) : now);
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

  private async saveCursor(ts: Date): Promise<void> {
    await this.prisma.jobCursor.upsert({
      where: { key: CURSOR },
      update: { ts, ref: '' },
      create: { key: CURSOR, ts },
    });
  }
}

type Keyset = { createdAt: Date; id: string };

/** Reads a source page by page in (createdAt, id) order, up to MAX_ROWS rows. */
async function paged<T extends Keyset>(read: (after: object) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let last: Keyset | null = null;
  while (out.length < MAX_ROWS) {
    const after = last
      ? {
          OR: [
            { createdAt: { gt: last.createdAt } },
            { createdAt: last.createdAt, id: { gt: last.id } },
          ],
        }
      : {};
    const page = await read(after);
    out.push(...page);
    if (page.length < PAGE) break;
    last = page.at(-1)!;
  }
  return out;
}
