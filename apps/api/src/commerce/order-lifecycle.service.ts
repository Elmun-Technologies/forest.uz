import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assertOrderTransition,
  assertPaymentTransition,
  computeDeliveryPromise,
  type DeliveryStatus,
  DomainError,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@forest/contracts';
import type { ActorType, Prisma } from '@forest/db';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { parcelWithCarrier } from '../delivery/shipment-state';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { fiscalEvidence } from './fiscal.service';
import { orderPageUrl } from './ids';
import { NotificationsService } from './notifications.service';
import { ReservationsService } from './reservations.service';

type Tx = Prisma.TransactionClient;

export interface Actor {
  type: ActorType;
  id?: string | null;
}

/**
 * Refunds are possible before the parcel leaves (the order is cancelled and stock released) and
 * after it came back / was cancelled; never while it is with the courier or delivered and kept —
 * those go through a return first (docs/02).
 */
const REFUNDABLE_ORDER: readonly OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PACKING',
  'READY',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
];
const CANCEL_ON_FULL_REFUND: readonly OrderStatus[] = ['NEW', 'CONFIRMED', 'PACKING', 'READY'];

export function orderAllowsRefund(status: OrderStatus): boolean {
  return REFUNDABLE_ORDER.includes(status);
}

/** Fulfilment path a delivery status pushes the order along (docs/02). */
const FULFILMENT_PATH: readonly OrderStatus[] = [
  'CONFIRMED',
  'PACKING',
  'READY',
  'HANDED_TO_COURIER',
  'DELIVERED',
];

/**
 * Order status a carrier status implies; null = no fulfilment change. `handedOver`: the carrier
 * status proves the parcel left the warehouse even though it maps to FAILED (Yandex `returning`,
 * `cancelled_with_items_on_hands` seen without `pickuped` in between).
 */
export function orderTargetForDelivery(
  delivery: DeliveryStatus,
  handedOver = false,
): OrderStatus | null {
  switch (delivery) {
    case 'PICKED_UP':
    case 'IN_TRANSIT':
    case 'AT_BRANCH':
      return 'HANDED_TO_COURIER';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'RETURNED':
      return 'RETURNED';
    case 'FAILED':
      // Retry or return follows; only a proven hand-over moves the order.
      return handedOver ? 'HANDED_TO_COURIER' : null;
    default:
      // NOT_CREATED / CREATED / COURIER_ASSIGNED: still in the warehouse.
      return null;
  }
}

/**
 * Steps from `from` to the order status implied by `delivery`, or [] when there is nothing to do:
 * already there or beyond, unconfirmed (NEW — a carrier never confirms an order), or a closed /
 * return branch (CANCELLED, COMPLETED, RETURN_REQUESTED, RETURNED).
 */
export function deliveryOrderSteps(
  from: OrderStatus,
  delivery: DeliveryStatus,
  handedOver = false,
): OrderStatus[] {
  const target = orderTargetForDelivery(delivery, handedOver);
  const at = FULFILMENT_PATH.indexOf(from);
  if (!target || at < 0) return [];
  if (target === 'RETURNED') {
    if (from === 'DELIVERED') return [];
    const handed = FULFILMENT_PATH.indexOf('HANDED_TO_COURIER');
    return [...FULFILMENT_PATH.slice(at + 1, handed + 1), 'RETURNED'];
  }
  const to = FULFILMENT_PATH.indexOf(target);
  return to > at ? FULFILMENT_PATH.slice(at + 1, to + 1) : [];
}

export interface ProviderTxnData {
  providerState: number;
  providerData?: Prisma.InputJsonValue;
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
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Locks the order row before reading its status, so two writers (operator confirm vs. the
   * expiry job) can't both see NEW and overwrite each other. Re-locking a row this transaction
   * already holds is a no-op; callers that also lock payments lock the order first.
   */
  async transition(
    tx: Tx,
    orderId: string,
    to: OrderStatus,
    actor: Actor,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    assertOrderTransition(order.status, to);
    // Closing the order needs fiscal evidence of the sale (docs/06 Fiscal, CLAUDE.md §6).
    if (to === 'COMPLETED' && !(await fiscalEvidence(tx, orderId)))
      throw new DomainError('FISCAL_RECEIPT_REQUIRED');
    // A courier is coming for (or has) the parcel: staff cancel the claim first (CLAUDE.md §6).
    if (to === 'CANCELLED' && (await this.parcelOut(tx, orderId)))
      throw new DomainError('DELIVERY_IN_PROGRESS');
    // Every exit from fulfilment frees the stock hold (idempotent).
    if (to === 'CANCELLED' || to === 'RETURNED') await this.reservations.release(tx, orderId);
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

  /** Caller holds the order lock (shipment rows change only under it). */
  private async parcelOut(tx: Tx, orderId: string): Promise<boolean> {
    const shipments = await tx.shipment.findMany({ where: { orderId } });
    return parcelWithCarrier(shipments, new Date());
  }

  /**
   * Moves the order along its fulfilment path as far as a carrier status implies (one transition
   * and OrderEvent per step, `data.cause = 'delivery'`). Caller holds the order lock (re-locking
   * is harmless) and sends notifications after commit. Returns the statuses entered, in order.
   */
  async advanceForDelivery(
    tx: Tx,
    orderId: string,
    delivery: DeliveryStatus,
    actor: Actor,
    opts: { handedOver?: boolean } = {},
  ): Promise<OrderStatus[]> {
    await this.lockOrder(tx, orderId);
    const { status } = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    const steps = deliveryOrderSteps(status, delivery, opts.handedOver);
    for (const to of steps)
      await this.transition(tx, orderId, to, actor, { cause: 'delivery', delivery });
    return steps;
  }

  /** A carrier SMS (`DELIVERY_NOTICE` marker) was already decided for this shipment. */
  async deliveryNoticeSent(
    tx: Tx,
    orderId: string,
    shipmentId: string,
    template: string,
  ): Promise<boolean> {
    const n = await tx.orderEvent.count({
      where: {
        orderId,
        type: 'DELIVERY_NOTICE',
        AND: [
          { data: { path: ['template'], equals: template } },
          { data: { path: ['shipmentId'], equals: shipmentId } },
        ],
      },
    });
    return n > 0;
  }

  /** Marker written in the status transaction; the SMS itself goes out after commit. */
  async recordDeliveryNotice(
    tx: Tx,
    orderId: string,
    shipmentId: string,
    template: string,
    delivery: DeliveryStatus,
  ): Promise<void> {
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'DELIVERY_NOTICE',
        actorType: 'SYSTEM',
        data: { template, delivery, shipmentId },
      },
    });
  }

  /**
   * DELIVERED (or a rejected return request) → COMPLETED. Throws FISCAL_RECEIPT_REQUIRED without a
   * receipt for the sale. RBAC comes with the admin controller (Phase 3).
   */
  async completeOrder(orderId: string, actor: Actor): Promise<void> {
    await this.prisma.$transaction((tx) => this.transition(tx, orderId, 'COMPLETED', actor));
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

  /** Row lock: duplicate/concurrent provider callbacks must be processed one at a time. */
  async lockPayment(tx: Tx, paymentId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  }

  async lockOrder(tx: Tx, orderId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
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
      // Same lock order as the provider webhooks (order → payment): no deadlocks between them.
      const { orderId: owner } = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderId: true },
      });
      await this.lockOrder(tx, owner);
      await this.lockPayment(tx, paymentId);
      return this.markPaidInTx(tx, paymentId, actor, {
        now,
        ...(providerTxnId ? { providerTxnId } : {}),
      });
    });
    if (orderId) await this.notifyPaid(orderId);
  }

  /**
   * markPaid inside the caller's transaction; the caller must hold the payment row lock
   * (`lockPayment`). Returns the order id when the payment became PAID now, null if it already
   * was. Call `notifyPaid` after commit.
   */
  async markPaidInTx(
    tx: Tx,
    paymentId: string,
    actor: Actor,
    opts: { now: Date; providerTxnId?: string } & Partial<ProviderTxnData>,
  ): Promise<string | null> {
    const p = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: { select: { status: true } } },
    });
    if (p.status === 'PAID') return null;
    await this.setPaymentStatus(tx, paymentId, 'PAID', actor, {
      performedAt: opts.now,
      ...(opts.providerTxnId ? { providerTxnId: opts.providerTxnId } : {}),
      ...(opts.providerState !== undefined ? { providerState: opts.providerState } : {}),
      ...(opts.providerData !== undefined ? { providerData: opts.providerData } : {}),
    });
    // Other open attempts of this order (e.g. the Click row after "pay again" while Payme paid)
    // can never be paid now; their provider history fields stay untouched.
    const siblings = await tx.payment.findMany({
      where: { orderId: p.orderId, id: { not: paymentId }, status: 'PENDING' },
      select: { id: true },
    });
    for (const s of siblings) {
      await this.lockPayment(tx, s.id);
      await this.setPaymentStatus(tx, s.id, 'EXPIRED', { type: 'SYSTEM' });
    }
    if (p.order.status === 'NEW') {
      await this.transition(tx, p.orderId, 'CONFIRMED', actor);
      await this.reservations.confirm(tx, p.orderId);
      await tx.order.update({
        where: { id: p.orderId },
        data: { slaDueAt: await this.slaDueAt(tx, p.orderId, opts.now) },
      });
    }
    return p.orderId;
  }

  /** Never throws (NotificationsService swallows errors), so webhooks may fire and forget. */
  async notifyPaid(orderId: string): Promise<void> {
    await this.notifications.orderStatus(orderId, 'order_paid');
  }

  async markFailed(paymentId: string, actor: Actor, reason?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPayment(tx, paymentId);
      await this.failAttemptInTx(tx, paymentId, actor, {
        providerData: reason ? { reason } : undefined,
      });
    });
  }

  /**
   * A provider attempt failed or was cancelled before money moved: PENDING → FAILED (customer may
   * retry while the reservation lives). Provider fields are updated even when the payment already
   * left PENDING (e.g. EXPIRED by the reservation job), so provider status queries stay exact.
   */
  async failAttemptInTx(
    tx: Tx,
    paymentId: string,
    actor: Actor,
    extra: Prisma.PaymentUpdateInput,
  ): Promise<void> {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === 'PENDING') await this.setPaymentStatus(tx, paymentId, 'FAILED', actor, extra);
    else if (Object.keys(extra).length)
      await tx.payment.update({ where: { id: paymentId }, data: extra });
  }

  /**
   * Binds a new provider transaction (Payme CreateTransaction / Click Prepare) to a payment row.
   * The order's latest online row is reused while no provider transaction is attached to it;
   * otherwise a new row is created, so every provider transaction keeps its own exact history.
   * Caller holds the order lock and has checked that the order is payable.
   */
  async attachProviderTxnInTx(
    tx: Tx,
    orderId: string,
    method: Exclude<PaymentMethod, 'COD'>,
    providerTxnId: string,
    data: ProviderTxnData,
    actor: Actor,
  ): Promise<string> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const latest = order.payments[0];
    const reusable =
      latest &&
      latest.method !== 'COD' &&
      !latest.providerTxnId &&
      (latest.status === 'PENDING' || latest.status === 'FAILED');
    const fields = {
      method,
      providerTxnId,
      providerState: data.providerState,
      providerData: data.providerData,
    };
    let paymentId: string;
    if (reusable) {
      if (latest.status !== 'PENDING') assertPaymentTransition(latest.status, 'PENDING');
      await tx.payment.update({ where: { id: latest.id }, data: { ...fields, status: 'PENDING' } });
      paymentId = latest.id;
    } else {
      const created = await tx.payment.create({
        data: { ...fields, orderId, status: 'PENDING', amountTiyin: order.totalTiyin },
      });
      paymentId = created.id;
    }
    if (order.paymentMethod !== method)
      await tx.order.update({ where: { id: orderId }, data: { paymentMethod: method } });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'PAYMENT_ATTEMPT',
        to: 'PENDING',
        actorType: actor.type,
        actorId: actor.id ?? null,
        data: { method, paymentId },
      },
    });
    return paymentId;
  }

  /**
   * Refund of a PAID payment (Payme cancel after perform, or a manual Click/COD refund).
   * Full refund before shipping cancels the order and releases its stock — refused while a
   * courier is dispatched for / has the parcel (staff cancel the claim first). Caller holds the
   * order → payment locks. Throws REFUND_NOT_ALLOWED / REFUND_AMOUNT_INVALID.
   */
  async refundInTx(
    tx: Tx,
    paymentId: string,
    actor: Actor,
    input: {
      amountTiyin: bigint;
      reason: string;
      /** Staff id, or `provider:<key>` for provider-initiated refunds. */
      refundedBy: string;
      extra?: Prisma.PaymentUpdateInput;
    },
  ): Promise<{ refundId: string; full: boolean }> {
    const p = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { refunds: true, order: { select: { id: true, status: true } } },
    });
    if (p.status !== 'PAID' && p.status !== 'PARTIALLY_REFUNDED')
      throw new DomainError('REFUND_NOT_ALLOWED', { paymentStatus: p.status });
    if (!orderAllowsRefund(p.order.status))
      throw new DomainError('REFUND_NOT_ALLOWED', { orderStatus: p.order.status });
    const refunded = p.refunds.reduce((sum, r) => sum + r.amountTiyin, 0n);
    const remaining = p.amountTiyin - refunded;
    if (input.amountTiyin <= 0n || input.amountTiyin > remaining)
      throw new DomainError('REFUND_AMOUNT_INVALID', { remainingTiyin: remaining.toString() });
    const full = input.amountTiyin === remaining;
    const cancels = full && CANCEL_ON_FULL_REFUND.includes(p.order.status);
    if (cancels && (await this.parcelOut(tx, p.order.id)))
      throw new DomainError('REFUND_NOT_ALLOWED', { delivery: 'in_progress' });
    const refund = await tx.refund.create({
      data: {
        paymentId,
        amountTiyin: input.amountTiyin,
        reason: input.reason,
        staffId: input.refundedBy,
      },
    });
    await this.setPaymentStatus(
      tx,
      paymentId,
      full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      actor,
      input.extra,
    );
    if (cancels) await this.transition(tx, p.order.id, 'CANCELLED', actor, { reason: 'refunded' });
    return { refundId: refund.id, full };
  }

  /**
   * Admin refund record for Click (reversal is done in the Click cabinet — docs/runbooks/payments)
   * and COD. Payme refunds are initiated in the Payme cabinet and arrive as CancelTransaction.
   * RBAC (Owner/Manager) is enforced by the admin controller (Phase 3).
   */
  async recordManualRefund(
    paymentId: string,
    input: { amountTiyin: bigint; reason: string; staffId: string },
  ): Promise<{ refundId: string; full: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const { orderId } = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderId: true },
      });
      // Order → payment, like the webhooks (refundInTx may cancel the order).
      await this.lockOrder(tx, orderId);
      await this.lockPayment(tx, paymentId);
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.method === 'PAYME') throw new DomainError('REFUND_VIA_PROVIDER_CABINET');
      return this.refundInTx(
        tx,
        paymentId,
        { type: 'STAFF', id: input.staffId },
        { amountTiyin: input.amountTiyin, reason: input.reason, refundedBy: input.staffId },
      );
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
    // COD: nothing is paid yet — "confirmed, pay the courier" (not the order_paid text).
    await this.notifications.orderStatus(orderId, 'order_confirmed');
  }

  /**
   * One payment reminder per unpaid online order, `paymentReminderMinutes` after it was placed and
   * while its reservation still holds (docs/02), linking to the order page ("pay again"). The
   * PAYMENT_REMINDER event is committed under the order lock before sending, so overlapping job
   * runs never send twice (a failed send is not retried: one reminder at most).
   */
  async remindUnpaid(now = new Date()): Promise<number> {
    const { paymentReminderMinutes } = await this.settings.get('delivery.rules');
    const due = await this.prisma.order.findMany({
      where: {
        status: 'NEW',
        paymentMethod: { not: 'COD' },
        createdAt: { lte: new Date(now.getTime() - paymentReminderMinutes * 60_000) },
        reservations: { some: { releasedAt: null, expiresAt: { gt: now } } },
        events: { none: { type: 'PAYMENT_REMINDER' } },
      },
      select: { id: true },
      take: 200,
    });
    let n = 0;
    for (const { id } of due) {
      try {
        const claim = await this.prisma.$transaction(async (tx) => {
          await this.lockOrder(tx, id);
          const order = await tx.order.findUniqueOrThrow({
            where: { id },
            include: {
              payments: { select: { status: true } },
              reservations: { where: { releasedAt: null } },
              events: { where: { type: 'PAYMENT_REMINDER' }, take: 1 },
            },
          });
          const expiresAt = order.reservations
            .map((r) => r.expiresAt?.getTime() ?? 0)
            .filter((t) => t > now.getTime())
            .sort((a, b) => a - b)[0];
          if (
            order.status !== 'NEW' ||
            order.paymentMethod === 'COD' ||
            order.events.length > 0 ||
            order.payments.some((p) => p.status === 'PAID') ||
            !expiresAt
          )
            return null;
          await tx.orderEvent.create({
            data: { orderId: id, type: 'PAYMENT_REMINDER', actorType: 'SYSTEM' },
          });
          return {
            order,
            minutesLeft: Math.max(1, Math.ceil((expiresAt - now.getTime()) / 60_000)),
          };
        });
        if (!claim) continue;
        const { order, minutesLeft } = claim;
        await this.notifications.orderStatus(id, 'payment_reminder', {
          vaqt: order.locale === 'ru' ? `${minutesLeft} мин` : `${minutesLeft} daqiqa`,
          link: orderPageUrl(this.env.APP_URL, order.locale, order.publicId),
        });
        n++;
      } catch (e) {
        this.logger.error(`payment reminder ${id} failed: ${String(e)}`);
      }
    }
    return n;
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
