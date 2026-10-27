import { Injectable } from '@nestjs/common';
import {
  type AdminBtsUpdateInput,
  type AdminManualOrderInput,
  type AdminManualOrderResultDto,
  type AdminOrderActionResultDto,
  type AdminOrderReceiptInput,
  type AdminOrderRefundInput,
  type AdminRefundResultDto,
  assertDeliveryTransition,
  type DeliveryStatus,
  DomainError,
  type OrderStatus,
  type Permission,
  soumToTiyin,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { createHash } from 'node:crypto';
import { CheckoutService } from '../../commerce/checkout.service';
import { FiscalService } from '../../commerce/fiscal.service';
import { NotificationsService } from '../../commerce/notifications.service';
import {
  type Actor,
  OrderLifecycleService,
  type TxHook,
} from '../../commerce/order-lifecycle.service';
import { ManualShipmentService } from '../../delivery/manual-shipment.service';
import { YandexShipmentService } from '../../delivery/yandex-shipment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

const done = (noop = false): AdminOrderActionResultDto => ({ ok: true, noop });

/**
 * A7 order actions. Every state change goes through the domain services (OrderLifecycleService,
 * FiscalService, Yandex/Manual shipment services, CheckoutService) and writes its audit row inside
 * the same transaction via their `audit` hook (CLAUDE.md §6). Calls that change nothing (double
 * click, already in that state) succeed as `noop` and are audited as such.
 */
@Injectable()
export class AdminOrderActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly fiscal: FiscalService,
    private readonly notifications: NotificationsService,
    private readonly manual: ManualShipmentService,
    private readonly yandex: YandexShipmentService,
    private readonly checkout: CheckoutService,
  ) {}

  private staff(actor: AuditActor): Actor {
    return { type: 'STAFF', id: actor.staffId };
  }

  private hook(actor: AuditActor, action: string, orderId: string, after?: unknown): TxHook {
    return (tx) =>
      this.audit.record(actor, { action, entity: 'Order', entityId: orderId, after }, tx);
  }

  /** Audits a call that changed nothing (the interceptor requires a row for every mutation). */
  private async finish(
    actor: AuditActor,
    action: string,
    orderId: string,
    after?: Record<string, unknown>,
  ): Promise<AdminOrderActionResultDto> {
    if (actor.audited) return done();
    await this.audit.record(actor, {
      action,
      entity: 'Order',
      entityId: orderId,
      after: { ...after, noop: true },
    });
    return done(true);
  }

  private async order(number: string) {
    const o = await this.prisma.order.findUnique({
      where: { number },
      select: { id: true, status: true, paymentMethod: true, carrier: true },
    });
    if (!o) throw new DomainError('ORDER_NOT_FOUND');
    return o;
  }

  /** COD: the operator called the customer (docs/02) → CONFIRMED, SLA starts. */
  async confirmCod(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (o.status === 'CONFIRMED') return this.finish(actor, 'order.cod_confirmed', o.id);
    // Online orders are confirmed by the payment webhook only.
    if (o.paymentMethod !== 'COD')
      throw new DomainError('ORDER_INVALID_TRANSITION', { from: o.status, to: 'CONFIRMED' });
    await this.lifecycle.confirmCod(
      o.id,
      this.staff(actor),
      new Date(),
      this.hook(actor, 'order.cod_confirmed', o.id),
    );
    return done();
  }

  /**
   * COD money received from the courier (docs/02: COD_PENDING → PAID when the courier settles).
   * Only after hand-over — before that a COD order is confirmed, not paid. No SMS: the customer
   * already paid at the door.
   */
  async codSettled(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    const action = 'order.cod_settled';
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockOrder(tx, o.id);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: o.id },
        select: { status: true, payments: { select: { id: true, method: true, status: true } } },
      });
      const cod = order.payments.find((p) => p.method === 'COD');
      if (cod?.status === 'PAID') return false;
      if (
        !cod ||
        cod.status !== 'COD_PENDING' ||
        !['HANDED_TO_COURIER', 'DELIVERED', 'COMPLETED'].includes(order.status)
      )
        throw new DomainError('PAYMENT_INVALID_TRANSITION', {
          from: cod?.status ?? null,
          to: 'PAID',
        });
      await this.lifecycle.lockPayment(tx, cod.id);
      await this.lifecycle.markPaidInTx(tx, cod.id, this.staff(actor), { now: new Date() });
      await this.hook(actor, action, o.id, { paymentId: cod.id })(tx);
      return true;
    });
    return changed ? done() : this.finish(actor, action, o.id);
  }

  /** CONFIRMED → PACKING, PACKING → READY (warehouse steps). */
  async advance(
    actor: AuditActor,
    number: string,
    to: Extract<OrderStatus, 'PACKING' | 'READY'>,
  ): Promise<AdminOrderActionResultDto> {
    const action = to === 'PACKING' ? 'order.packing_started' : 'order.ready';
    const o = await this.order(number);
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockOrder(tx, o.id);
      const { status } = await tx.order.findUniqueOrThrow({
        where: { id: o.id },
        select: { status: true },
      });
      if (status === to) return false;
      await this.lifecycle.transition(tx, o.id, to, this.staff(actor));
      await this.hook(actor, action, o.id, { from: status, to })(tx);
      return true;
    });
    return changed ? done() : this.finish(actor, action, o.id);
  }

  /**
   * Customer collected the parcel (PICKUP — no carrier reports it): the order is walked to
   * DELIVERED along the fulfilment path, one OrderEvent per step.
   */
  async markDelivered(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (o.carrier !== 'PICKUP') throw new DomainError('SHIPMENT_CARRIER_MISMATCH');
    if (o.status === 'DELIVERED') return this.finish(actor, 'order.delivered', o.id);
    await this.prisma.$transaction(async (tx) => {
      const steps = await this.lifecycle.advanceForDelivery(
        tx,
        o.id,
        'DELIVERED',
        this.staff(actor),
      );
      if (steps.length === 0)
        throw new DomainError('ORDER_INVALID_TRANSITION', { from: o.status, to: 'DELIVERED' });
      await this.pickupShipmentDelivered(tx, o.id, actor);
      await this.hook(actor, 'order.delivered', o.id, { carrier: 'PICKUP', steps })(tx);
    });
    await this.notifications.orderStatus(o.id, 'order_delivered');
    return done();
  }

  /**
   * PICKUP shipment through the delivery state machine (NOT_CREATED → CREATED → DELIVERED, the
   * same first-entry walk as BTS manual mode) with history entries and a DELIVERY_STATUS event.
   * Caller holds the order lock (advanceForDelivery took it).
   */
  private async pickupShipmentDelivered(
    tx: Prisma.TransactionClient,
    orderId: string,
    actor: AuditActor,
  ): Promise<void> {
    const shipment = await tx.shipment.findFirst({ where: { orderId, carrier: 'PICKUP' } });
    if (!shipment || shipment.status === 'DELIVERED') return;
    const path: DeliveryStatus[] = [];
    let cur: DeliveryStatus = shipment.status;
    if (cur === 'NOT_CREATED') path.push((cur = 'CREATED'));
    assertDeliveryTransition(cur, 'DELIVERED');
    path.push('DELIVERED');
    const at = new Date().toISOString();
    const history = [
      ...((Array.isArray(shipment.history) ? shipment.history : []) as Prisma.JsonArray),
      ...path.map((status) => ({ at, status, note: 'Mijoz olib ketdi' })),
    ];
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: 'DELIVERED', history },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'DELIVERY_STATUS',
        from: shipment.status,
        to: 'DELIVERED',
        actorType: 'STAFF',
        actorId: actor.staffId,
        data: { carrier: 'PICKUP', mode: 'manual' },
      },
    });
  }

  async complete(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (o.status === 'COMPLETED') return this.finish(actor, 'order.completed', o.id);
    await this.lifecycle.completeOrder(
      o.id,
      this.staff(actor),
      this.hook(actor, 'order.completed', o.id),
    );
    return done();
  }

  async cancel(
    actor: AuditActor,
    number: string,
    reason: string,
  ): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (o.status === 'CANCELLED') return this.finish(actor, 'order.cancelled', o.id);
    await this.lifecycle.cancelOrder(
      o.id,
      this.staff(actor),
      reason,
      this.hook(actor, 'order.cancelled', o.id, { from: o.status, reason }),
    );
    return done();
  }

  async recordReceipt(
    actor: AuditActor,
    number: string,
    input: AdminOrderReceiptInput,
  ): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    await this.fiscal.recordManualReceipt(o.id, input, actor.staffId, actor.ip, (tx, change) =>
      this.audit.record(
        actor,
        {
          action: change.corrected
            ? 'order.fiscal_receipt_corrected'
            : 'order.fiscal_receipt_recorded',
          entity: 'Order',
          entityId: o.id,
          before: change.before ?? undefined,
          after: change.after,
        },
        tx,
      ),
    );
    return done();
  }

  /**
   * Full or partial refund (docs/02: Owner/Manager). Click/COD: recorded here, the money moves in
   * the Click cabinet / in cash; Payme: REFUND_VIA_PROVIDER_CABINET. Idempotency-Key required.
   */
  async refund(
    actor: AuditActor,
    number: string,
    key: string,
    input: AdminOrderRefundInput,
  ): Promise<AdminRefundResultDto> {
    const o = await this.order(number);
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    const payment = await this.prisma.payment.findFirst({
      where: { id: input.paymentId, orderId: o.id },
      select: { id: true },
    });
    if (!payment) throw new DomainError('NOT_FOUND', undefined, 'paymentId');
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ number, ...input }))
      .digest('hex');
    try {
      await this.prisma.idempotencyKey.create({
        data: { key, scope: 'admin_refund', requestHash },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { key } });
      const response = existing.response as AdminRefundResultDto | null;
      if (existing.scope !== 'admin_refund' || existing.requestHash !== requestHash || !response)
        throw new DomainError('IDEMPOTENCY_CONFLICT');
      await this.finish(actor, 'order.refund_recorded', o.id, { refundId: response.refundId });
      return response;
    }
    try {
      const amountTiyin = soumToTiyin(input.amountSoum);
      const audit = this.hook(actor, 'order.refund_recorded', o.id, {
        paymentId: payment.id,
        amountSoum: input.amountSoum,
        reason: input.reason,
      });
      const result = await this.lifecycle.recordManualRefund(
        payment.id,
        { amountTiyin, reason: input.reason, staffId: actor.staffId },
        async (tx) => {
          await audit(tx);
          // The stored response commits with the refund (same transaction): a retry after a lost
          // answer replays it instead of refunding twice.
          const refund = await tx.refund.findFirstOrThrow({
            where: { paymentId: payment.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, payment: { select: { status: true } } },
          });
          await tx.idempotencyKey.update({
            where: { key },
            data: {
              status: 200,
              response: { refundId: refund.id, full: refund.payment.status === 'REFUNDED' },
            },
          });
        },
      );
      return { refundId: result.refundId, full: result.full };
    } catch (e) {
      // A refused refund may be retried with the same key (e.g. after correcting the amount);
      // one that committed (response stored) never is.
      const row = await this.prisma.idempotencyKey.findUnique({ where: { key } }).catch(() => null);
      if (!row?.response)
        await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      throw e;
    }
  }

  /** Internal note: staff-only OrderEvent `NOTE` (never in customer DTOs). */
  async note(actor: AuditActor, number: string, text: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    await this.prisma.$transaction(async (tx) => {
      const e = await tx.orderEvent.create({
        data: {
          orderId: o.id,
          type: 'NOTE',
          actorType: 'STAFF',
          actorId: actor.staffId,
          data: { text },
        },
      });
      await this.hook(actor, 'order.note_added', o.id, { eventId: e.id })(tx);
    });
    return done();
  }

  /** BTS manual mode: waybill, branch and status (ManualShipmentService). */
  async bts(
    actor: AuditActor,
    number: string,
    input: AdminBtsUpdateInput,
  ): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    const action = 'order.shipment_updated';
    await this.manual.setManualShipment(
      o.id,
      input,
      actor.staffId,
      new Date(),
      this.hook(actor, action, o.id, {
        carrier: 'BTS',
        status: input.status,
        trackNumber: input.trackNumber ?? null,
      }),
    );
    return this.finish(actor, action, o.id, { carrier: 'BTS', status: input.status });
  }

  private async yandexShipmentId(orderId: string): Promise<string> {
    const s = await this.yandex.shipmentForOrder(orderId);
    if (!s?.externalId) throw new DomainError('DELIVERY_CLAIM_NOT_READY');
    return s.id;
  }

  /** "Yandex kuryer chaqirish" step 1: estimate only — no courier until `yandexAccept`. */
  async yandexCreate(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    const action = 'order.yandex_claim_created';
    await this.yandex.createClaim(o.id, this.staff(actor), this.hook(actor, action, o.id));
    return this.finish(actor, action, o.id);
  }

  /** Step 2: dispatches a real, paid courier (refused in integration test mode). */
  async yandexAccept(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    const action = 'order.yandex_claim_accepted';
    const shipmentId = await this.yandexShipmentId(o.id);
    await this.yandex.acceptClaim(shipmentId, this.staff(actor), this.hook(actor, action, o.id));
    return this.finish(actor, action, o.id);
  }

  /** Free cancel needs `orders.edit`; a paid one (fee) also `orders.cancel_refund`. */
  async yandexCancel(
    actor: AuditActor,
    number: string,
    allowPaid: boolean,
    permissions: readonly Permission[],
  ): Promise<AdminOrderActionResultDto> {
    if (allowPaid && !permissions.includes('orders.cancel_refund'))
      throw new DomainError('FORBIDDEN');
    const o = await this.order(number);
    const action = 'order.yandex_claim_cancelled';
    const shipmentId = await this.yandexShipmentId(o.id);
    await this.yandex.cancelClaim(
      shipmentId,
      this.staff(actor),
      { allowPaid },
      this.hook(actor, action, o.id, { allowPaid }),
    );
    return this.finish(actor, action, o.id, { allowPaid });
  }

  /** Re-reads the claim now (instead of waiting for the minute poll). */
  async yandexRefresh(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    const shipmentId = await this.yandexShipmentId(o.id);
    const r = await this.yandex.refresh(shipmentId);
    await this.audit.record(actor, {
      action: 'order.yandex_claim_refreshed',
      entity: 'Order',
      entityId: o.id,
      after: { applied: r.applied, status: r.status },
    });
    return done(!r.applied);
  }

  /** The parcel of a dead claim is back in the warehouse → shipment + order RETURNED. */
  async yandexReturned(actor: AuditActor, number: string): Promise<AdminOrderActionResultDto> {
    const o = await this.order(number);
    const shipmentId = await this.yandexShipmentId(o.id);
    await this.yandex.markReturned(
      shipmentId,
      this.staff(actor),
      new Date(),
      this.hook(actor, 'order.parcel_returned', o.id),
    );
    return done();
  }

  /** A6 "+ Qo'lda buyurtma": phone order through the checkout transaction (CLAUDE.md §6). */
  async manualOrder(
    actor: AuditActor,
    key: string,
    input: AdminManualOrderInput,
  ): Promise<AdminManualOrderResultDto> {
    if (!actor.staffId) throw new DomainError('UNAUTHORIZED');
    const { lines, ...rest } = input;
    const result = await this.checkout.placeForStaff(
      key,
      { ...rest, lines },
      actor.staffId,
      (tx, order) =>
        this.audit.record(
          actor,
          {
            action: 'order.manual_created',
            entity: 'Order',
            entityId: order.id,
            after: { number: order.number, zoneKey: input.zoneKey, lines: lines.length },
          },
          tx,
        ),
    );
    if (result.replayed)
      await this.audit.record(actor, {
        action: 'order.manual_created',
        entity: 'Order',
        entityId: await this.order(result.orderNumber).then((o) => o.id),
        after: { number: result.orderNumber, noop: true },
      });
    return { number: result.orderNumber };
  }
}
