import { Injectable } from '@nestjs/common';
import { BOT_LIMITS, type Locale } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';
import { BotAlertsService } from './bot-alerts.service';
import { BotInboxService } from './bot-inbox.service';

export type RateOutcome =
  | { kind: 'stale' }
  | { kind: 'already' }
  | { kind: 'high' | 'low'; reviewId: string; orderNumber: string };

const RATEABLE = ['DELIVERED', 'COMPLETED'] as const;

/**
 * Review flow from the bot (docs/09 flow 5, CLAUDE.md §6 5A): stars → review (PENDING, source
 * bot) for the order's main product → photos (private) → RAHMAT5 → publish consent.
 */
@Injectable()
export class BotReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: BotInboxService,
    private readonly alerts: BotAlertsService,
  ) {}

  async rate(
    chatId: bigint,
    customerId: string | null,
    orderId: string,
    stars: number,
    locale: Locale,
    now = new Date(),
  ): Promise<RateOutcome> {
    if (!customerId || !Number.isInteger(stars) || stars < 1 || stars > 5) return { kind: 'stale' };
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { variant: { select: { productId: true } } } } },
    });
    if (
      !order ||
      order.customerId !== customerId ||
      !(RATEABLE as readonly string[]).includes(order.status) ||
      !order.items.length
    )
      return { kind: 'stale' };
    // The order's main product: largest line total.
    const main = [...order.items].sort((a, b) => {
      const ta = a.priceTiyin * BigInt(a.qty) - a.discountTiyin;
      const tb = b.priceTiyin * BigInt(b.qty) - b.discountTiyin;
      return tb > ta ? 1 : tb < ta ? -1 : 0;
    })[0]!;
    let reviewId: string;
    try {
      const r = await this.prisma.review.create({
        data: {
          productId: main.variant.productId,
          customerId,
          orderId,
          rating: stars,
          locale,
          source: 'bot',
          status: 'PENDING',
          createdAt: now,
        },
        select: { id: true },
      });
      reviewId = r.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return { kind: 'already' };
      throw e;
    }
    if (stars <= 3) {
      await this.inbox.reviewComplaint(chatId, customerId, `${stars} ★ · ${order.number}`, now);
      this.alerts.reviewLow(reviewId, stars, order.number);
      return { kind: 'low', reviewId, orderNumber: order.number };
    }
    return { kind: 'high', reviewId, orderNumber: order.number };
  }

  /** The customer's own review still collecting photos/consent, else null. */
  async own(reviewId: string, customerId: string | null) {
    if (!customerId) return null;
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    return r && r.customerId === customerId && r.source === 'bot' ? r : null;
  }

  /** Adds a stored photo (≤ 5). Returns the photo count, or null when the review is full. */
  async addPhoto(reviewId: string, fileId: string): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Review" WHERE id = ${reviewId} FOR UPDATE`;
      const r = await tx.review.findUniqueOrThrow({ where: { id: reviewId } });
      if (r.photoFileIds.length >= BOT_LIMITS.reviewPhotos) return null;
      const next = [...r.photoFileIds, fileId];
      await tx.review.update({ where: { id: reviewId }, data: { photoFileIds: next } });
      return next.length;
    });
  }

  async setConsent(reviewId: string, consent: boolean): Promise<void> {
    await this.prisma.review.update({ where: { id: reviewId }, data: { photoConsent: consent } });
  }

  /** The first text in the flow becomes the review text. */
  async setTextOnce(reviewId: string, text: string): Promise<boolean> {
    const r = await this.prisma.review.updateMany({
      where: { id: reviewId, text: null },
      data: { text: text.slice(0, 2000) },
    });
    return r.count > 0;
  }
}
