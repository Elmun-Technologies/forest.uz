import {
  ATTRIBUTION_LOOKBACK_DAYS,
  ATTRIBUTION_MAX_TOUCHES,
  attributeTouches,
  type OrderAttribution,
} from '@forest/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { isPurchase } from '../admin/analytics/sql';
import { PrismaService } from '../prisma/prisma.service';
import { loadTouches, orderTouch } from './touches';

const DAY_MS = 86_400_000;
const BATCH = 200;

/**
 * Stores `Order.attribution` once an order is a purchase (CLAUDE.md §6). Polls instead of hooking
 * the order lifecycle, so payment/COD semantics stay untouched; the conditional UPDATE makes
 * overlapping runs (several API replicas) harmless.
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger('Attribution');

  constructor(private readonly prisma: PrismaService) {}

  /** One run of `analytics.attribution.compute`: returns the number of orders attributed. */
  async computePending(now = new Date(), limit = BATCH): Promise<number> {
    const pending = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM "Order" o
      WHERE o.attribution IS NULL AND ${isPurchase('o')}
      ORDER BY o."createdAt" LIMIT ${limit}`;
    let done = 0;
    for (const { id } of pending) {
      try {
        if (await this.computeOrder(id, now)) done++;
      } catch (e) {
        this.logger.error(`attribution failed for order ${id}: ${(e as Error).message}`);
      }
    }
    return done;
  }

  /** Builds the order's journey and stores it unless already stored. */
  async computeOrder(orderId: string, now = new Date()): Promise<OrderAttribution | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        createdAt: true,
        source: true,
        anonymousId: true,
        sessionId: true,
      },
    });
    if (!order) return null;
    const [prev] = await this.prisma.$queryRaw<{ at: Date | null }[]>`
      SELECT MAX(o."createdAt") AS at FROM "Order" o
      WHERE o."customerId" = ${order.customerId} AND o."createdAt" < ${order.createdAt}
        AND o.id <> ${order.id} AND ${isPurchase('o')}`;
    const lookback = new Date(order.createdAt.getTime() - ATTRIBUTION_LOOKBACK_DAYS * DAY_MS);
    const after = prev?.at && prev.at > lookback ? prev.at : lookback;
    const touches = await loadTouches(this.prisma, {
      customerId: order.customerId,
      after,
      until: order.createdAt,
      anonymousId: order.anonymousId,
      sessionId: order.sessionId,
      limit: ATTRIBUTION_MAX_TOUCHES,
    });
    const attribution = attributeTouches(touches.length ? touches : [orderTouch(order)], now);
    const updated = await this.prisma.$executeRaw`
      UPDATE "Order" SET attribution = ${JSON.stringify(attribution)}::jsonb
      WHERE id = ${order.id} AND attribution IS NULL`;
    return updated ? attribution : null;
  }
}
