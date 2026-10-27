import { Injectable } from '@nestjs/common';
import {
  assertDeliveryTransition,
  DELIVERY_STATUSES,
  type DeliveryStatus,
  DomainError,
  type OrderStatus,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { NotificationsService } from '../commerce/notifications.service';
import {
  type Actor,
  OrderLifecycleService,
  type TxHook,
} from '../commerce/order-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ManualShipmentInput {
  /** BTS waybill / track number; required once the parcel exists at BTS. */
  trackNumber?: string | null;
  /** Pick-up branch (name/address as BTS shows it), for branch deliveries. */
  branch?: string | null;
  status: DeliveryStatus;
  note?: string | null;
}

export interface ManualShipmentResult {
  deliveryStatus: DeliveryStatus;
  orderStatus: OrderStatus;
  /** Order statuses entered by this update, in order. */
  orderSteps: OrderStatus[];
  /** Message templates sent after commit. */
  notified: string[];
  changed: boolean;
}

interface HistoryEntry {
  at: string;
  status: DeliveryStatus;
  place?: string;
  note?: string;
}

const TRACK = /^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/;
/** Orders whose parcel may be booked/updated: confirmed (paid or operator-confirmed), not cancelled. */
const NOT_SHIPPABLE: readonly OrderStatus[] = ['NEW', 'CANCELLED'];

function clean(v: string | null | undefined, max: number, field: string): string | null {
  const s = v?.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > max) throw new DomainError('VALIDATION_FAILED', { max }, field);
  return s;
}

const ON_THE_WAY: readonly DeliveryStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'AT_BRANCH'];

/**
 * Service SMS for what the customer must know (docs/02, docs/09): the parcel left with BTS (track
 * number), it waits at a branch, it was delivered, or delivery failed. In-transit scans stay
 * silent (tracking page only). "Shipped" only while the parcel is on its way (not for a first
 * entry straight to DELIVERED / RETURNED); "failed" only once, and only when BTS had the parcel
 * (`orderStatus` HANDED_TO_COURIER after this update).
 */
export function manualShipmentNotices(
  to: DeliveryStatus,
  orderSteps: readonly OrderStatus[],
  vars: { trek: string; filial: string },
  ctx: { orderStatus: OrderStatus; failedNoticeSent: boolean },
): { template: string; vars: Record<string, string> }[] {
  const out: { template: string; vars: Record<string, string> }[] = [];
  if (orderSteps.includes('HANDED_TO_COURIER') && ON_THE_WAY.includes(to))
    out.push({ template: 'order_shipped_bts', vars: { trek: vars.trek } });
  if (to === 'AT_BRANCH' && vars.filial)
    out.push({ template: 'order_at_branch', vars: { filial: vars.filial } });
  if (to === 'DELIVERED') out.push({ template: 'order_delivered', vars: {} });
  if (to === 'FAILED' && ctx.orderStatus === 'HANDED_TO_COURIER' && !ctx.failedNoticeSent)
    out.push({ template: 'order_delivery_failed', vars: {} });
  return out;
}

/**
 * BTS manual mode (docs/06 Delivery, CLAUDE.md §6): the operator records the waybill and each
 * status; the shipment follows the delivery state machine, every change is appended to its
 * history and written to OrderEvent, the order is advanced consistently (OrderLifecycleService
 * .advanceForDelivery) and the customer gets the matching service SMS. Admin: A7 delivery block
 * (`orders.edit`); `audit` runs in the change's transaction (unchanged input calls it not).
 */
@Injectable()
export class ManualShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  async setManualShipment(
    orderId: string,
    input: ManualShipmentInput,
    staffId: string,
    now = new Date(),
    audit?: TxHook,
  ): Promise<ManualShipmentResult> {
    if (!DELIVERY_STATUSES.includes(input.status) || input.status === 'NOT_CREATED')
      throw new DomainError('VALIDATION_FAILED', undefined, 'status');
    const trackInput = clean(input.trackNumber, 40, 'trackNumber');
    if (trackInput && !TRACK.test(trackInput))
      throw new DomainError('VALIDATION_FAILED', undefined, 'trackNumber');
    const branchInput = clean(input.branch, 200, 'branch');
    const note = clean(input.note, 300, 'note');
    const actor: Actor = { type: 'STAFF', id: staffId };

    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { shipments: true },
      });
      if (!order) throw new DomainError('ORDER_NOT_FOUND');
      const shipment = order.shipments.find((s) => s.carrier === 'BTS');
      if (order.carrier !== 'BTS' || !shipment) throw new DomainError('SHIPMENT_CARRIER_MISMATCH');
      if (NOT_SHIPPABLE.includes(order.status))
        throw new DomainError('SHIPMENT_ORDER_NOT_READY', { orderStatus: order.status });

      const trackNumber = trackInput ?? shipment.trackNumber;
      if (!trackNumber) throw new DomainError('VALIDATION_FAILED', undefined, 'trackNumber');
      const prevBranch = (shipment.branch as { name?: string } | null)?.name ?? null;
      const branch = branchInput ?? prevBranch;

      // A first update may already be past CREATED (booked at the branch, then entered here).
      const path: DeliveryStatus[] = [];
      let cur = shipment.status;
      if (cur === 'NOT_CREATED' && input.status !== 'CREATED') path.push((cur = 'CREATED'));
      if (cur !== input.status) {
        assertDeliveryTransition(cur, input.status);
        path.push(input.status);
      }
      const fieldsChanged = trackNumber !== shipment.trackNumber || branch !== prevBranch;
      if (path.length === 0 && !fieldsChanged && !note)
        return { changed: false as const, orderStatus: order.status };

      const history = [...((shipment.history as HistoryEntry[] | null) ?? [])];
      const at = now.toISOString();
      for (const status of path)
        history.push({
          at,
          status,
          ...(branch && status === 'AT_BRANCH' ? { place: branch } : {}),
          ...(note && status === input.status ? { note } : {}),
        });
      // A note or a corrected track number without a status change is still part of the history.
      if (path.length === 0 && note) history.push({ at, status: cur, note });

      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: input.status,
          trackNumber,
          externalId: trackNumber,
          branch: branch ? { name: branch } : undefined,
          history: history as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'DELIVERY_STATUS',
          from: shipment.status,
          to: input.status,
          actorType: 'STAFF',
          actorId: staffId,
          data: { carrier: 'BTS', mode: 'manual', trackNumber, ...(note ? { note } : {}) },
        },
      });
      const orderSteps = await this.lifecycle.advanceForDelivery(tx, orderId, input.status, actor);
      const orderStatus = orderSteps.at(-1) ?? order.status;
      const notices = path.length
        ? manualShipmentNotices(
            input.status,
            orderSteps,
            { trek: trackNumber, filial: branch ?? '' },
            {
              orderStatus,
              failedNoticeSent: await this.lifecycle.deliveryNoticeSent(
                tx,
                orderId,
                shipment.id,
                'order_delivery_failed',
              ),
            },
          )
        : [];
      for (const n of notices)
        await this.lifecycle.recordDeliveryNotice(
          tx,
          orderId,
          shipment.id,
          n.template,
          input.status,
        );
      await audit?.(tx);
      return { changed: true as const, notices, orderSteps, orderStatus };
    });

    if (!outcome.changed)
      return {
        deliveryStatus: input.status,
        orderStatus: outcome.orderStatus,
        orderSteps: [],
        notified: [],
        changed: false,
      };
    const { notices } = outcome;
    // After commit; NotificationsService never throws.
    for (const n of notices) await this.notifications.orderStatus(orderId, n.template, n.vars);
    return {
      deliveryStatus: input.status,
      orderStatus: outcome.orderStatus,
      orderSteps: outcome.orderSteps,
      notified: notices.map((n) => n.template),
      changed: true,
    };
  }
}
