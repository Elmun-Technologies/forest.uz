import { Injectable, Logger } from '@nestjs/common';
import {
  assertOrderTransition,
  assertPaymentTransition,
  computeDeliveryPromise,
  type OrderStatus,
  type PaymentStatus,
} from '@forest/contracts';
import type { ActorType, Prisma } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';
import { ReservationsService } from './reservations.service';

type Tx = Prisma.TransactionClient;

export interface Actor {
  type: ActorType;
  id?: string | null;
}

/**
 * The only place that changes order/payment status (invariant 4): every transition is checked
 * against the state machine in @forest/contracts and written to OrderEvent.
 */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger('OrderLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async transition(
    tx: Tx,
    orderId: string,
    to: OrderStatus,
    actor: Actor,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    assertOrderTransition(order.status, to);
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(to === 'CANCELLED' && data?.reason ? { cancelReason: String(data.reason) } : {}),
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_CHANGED',
        from: order.status,
        to,
        actorType: actor.type,
        actorId: actor.id ?? null,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async setPaymentStatus(
    tx: Tx,
    paymentId: string,
    to: PaymentStatus,
    actor: Actor,
    extra: Prisma.PaymentUpdateInput = {},
  ): Promise<{ orderId: string; from: PaymentStatus }> {
    const p = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, orderId: true },
    });
    assertPaymentTransition(p.status, to);
    await tx.payment.update({ where: { id: paymentId }, data: { status: to, ...extra } });
    await tx.orderEvent.create({
      data: {
        orderId: p.orderId,
        type: `PAYMENT_${to}`,
        from: p.status,
        to,
        actorType: actor.type,
        actorId: actor.id ?? null,
      },
    });
    return { orderId: p.orderId, from: p.status };
  }

  /** SLA clock starts at payment confirmation (online) or operator confirmation (COD). */
  private async slaDueAt(tx: Tx, orderId: string, start: Date): Promise<Date | null> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { deliveryZone: true },
    });
    const zone = (await this.settings.get('delivery.zones')).find(
      (z) => z.key === order.deliveryZone,
    );
    return zone ? computeDeliveryPromise(start, zone.rule).deadline : null;
  }

  /**
   * Online payment confirmed by the provider webhook (the only source of truth for "paid").
   * Idempotent: a second call for an already PAID payment is a no-op.
   */
  async markPaid(
    paymentId: string,
    actor: Actor,
    providerTxnId?: string | null,
    now = new Date(),
  ): Promise<void> {
    const orderId = await this.prisma.$transaction(async (tx) => {
      // Row lock: duplicate/concurrent provider callbacks must be processed one at a time.
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { order: { select: { status: true } } },
      });
      if (p.status === 'PAID') return null;
      await this.setPaymentStatus(tx, paymentId, 'PAID', actor, {
        performedAt: now,
        ...(providerTxnId ? { providerTxnId } : {}),
      });
      if (p.order.status === 'NEW') {
        await this.transition(tx, p.orderId, 'CONFIRMED', actor);
        await this.reservations.confirm(tx, p.orderId);
        await tx.order.update({
          where: { id: p.orderId },
          data: { slaDueAt: await this.slaDueAt(tx, p.orderId, now) },
        });
      }
      return p.orderId;
    });
    if (orderId) await this.notifications.orderStatus(orderId, 'order_paid');
  }

  async markFailed(paymentId: string, actor: Actor, reason?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status !== 'PENDING') return;
      await this.setPaymentStatus(tx, paymentId, 'FAILED', actor, {
        providerData: reason ? { reason } : undefined,
      });
    });
  }

  /** COD: operator confirmed by phone → order CONFIRMED, SLA starts, reservation becomes a hold. */
  async confirmCod(orderId: string, actor: Actor, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, orderId, 'CONFIRMED', actor);
      await this.reservations.confirm(tx, orderId);
      await tx.order.update({
        where: { id: orderId },
        data: { slaDueAt: await this.slaDueAt(tx, orderId, now) },
      });
    });
    await this.notifications.orderStatus(orderId, 'order_paid');
  }

  /**
   * Unpaid online orders past the reservation window and unconfirmed COD orders past the
   * auto-cancel window: payment EXPIRED, stock released, order CANCELLED (docs/02).
   */
  async expireStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'NEW',
        reservations: { some: { releasedAt: null, expiresAt: { lt: now } } },
      },
      select: { id: true },
      take: 200,
    });
    let n = 0;
    for (const { id } of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
          const order = await tx.order.findUniqueOrThrow({
            where: { id },
            include: { payments: true },
          });
          if (order.status !== 'NEW') return;
          for (const p of order.payments.filter((x) =>
            ['PENDING', 'FAILED', 'COD_PENDING'].includes(x.status),
          )) {
            await this.setPaymentStatus(tx, p.id, 'EXPIRED', { type: 'SYSTEM' });
          }
          await this.reservations.release(tx, id);
          await this.transition(
            tx,
            id,
            'CANCELLED',
            { type: 'SYSTEM' },
            { reason: 'unpaid_expired' },
          );
        });
        n++;
      } catch (e) {
        this.logger.error(`expire ${id} failed: ${String(e)}`);
      }
    }
    return n;
  }
}
