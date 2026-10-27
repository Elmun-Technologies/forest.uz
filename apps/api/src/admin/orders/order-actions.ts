import type {
  AdminOrderActionDto,
  AdminOrderActionKey,
  Carrier,
  ErrorCode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Permission,
} from '@forest/contracts';
import { orderAllowsRefund } from '../../commerce/order-lifecycle.service';
import {
  acceptPending,
  parcelWithCarrier,
  type ShipmentFacts,
  yandexClaimDead,
} from '../../delivery/shipment-state';

/** What `orderActions` decides on: the order's three state machines, nothing else. */
export interface OrderFacts {
  status: OrderStatus;
  carrier: Carrier;
  payments: readonly { method: PaymentMethod; status: PaymentStatus }[];
  shipments: readonly ShipmentFacts[];
  /** A sale receipt exists (manual / OFD / provider) — `fiscalEvidence`. */
  fiscalEvidence: boolean;
}

/** Orders a Yandex courier may be called for (mirrors `YandexShipmentService`). */
const CLAIMABLE: readonly OrderStatus[] = ['CONFIRMED', 'PACKING', 'READY'];
/** Before the parcel leaves the warehouse: staff may still cancel. */
const CANCELLABLE: readonly OrderStatus[] = ['NEW', 'CONFIRMED', 'PACKING', 'READY'];
/** Yandex claim states that still wait for staff acceptance. */
const PRE_ACCEPT = ['new', 'estimating', 'ready_for_approval'];
const PAID: readonly PaymentStatus[] = ['PAID', 'PARTIALLY_REFUNDED'];

/**
 * Next actions the A7 page offers this staff member (CLAUDE.md §6): derived from the order,
 * payment and delivery state machines plus permissions. `blockedBy` marks a visible action the
 * server would refuse now (shown disabled with the reason). The services re-check everything.
 */
export function orderActions(
  o: OrderFacts,
  permissions: readonly Permission[],
  now: Date,
): AdminOrderActionDto[] {
  const can = (p: Permission) => permissions.includes(p);
  const out: AdminOrderActionDto[] = [];
  const add = (key: AdminOrderActionKey, blockedBy: ErrorCode | null = null) =>
    out.push({ key, blockedBy });

  const paid = o.payments.filter((p) => PAID.includes(p.status));
  const yandex = o.shipments.find((s) => s.carrier === 'YANDEX');
  const claimDead = !yandex || yandexClaimDead(yandex);
  const bts = o.shipments.find((s) => s.carrier === 'BTS');

  if (can('orders.edit')) {
    if (o.status === 'NEW' && o.payments.some((p) => p.status === 'COD_PENDING'))
      add('confirm_cod');
    // Courier handed over the cash (docs/02 COD_PENDING → PAID when the courier settles).
    if (
      ['HANDED_TO_COURIER', 'DELIVERED', 'COMPLETED'].includes(o.status) &&
      o.payments.some((p) => p.status === 'COD_PENDING')
    )
      add('cod_settled');
    if (o.status === 'CONFIRMED') add('start_packing');
    if (o.status === 'PACKING') add('mark_ready');

    if (o.carrier === 'YANDEX') {
      if (CLAIMABLE.includes(o.status) && claimDead) add('yandex_create_claim');
      if (
        yandex &&
        !claimDead &&
        CLAIMABLE.includes(o.status) &&
        !yandex.acceptedAt &&
        !acceptPending(yandex, now) &&
        PRE_ACCEPT.includes(yandex.providerStatus ?? 'new')
      )
        add(
          'yandex_accept_claim',
          yandex.providerStatus === 'ready_for_approval' ? null : 'DELIVERY_CLAIM_NOT_READY',
        );
      // After pickup only Yandex support can cancel (docs/runbooks/delivery.md).
      if (yandex && !claimDead && ['CREATED', 'COURIER_ASSIGNED'].includes(yandex.status))
        add('yandex_cancel_claim');
      if (yandex?.externalId) add('yandex_refresh');
      if (yandex?.status === 'FAILED' && o.status === 'HANDED_TO_COURIER')
        add('yandex_mark_returned');
    }

    if (
      o.carrier === 'BTS' &&
      !['NEW', 'CANCELLED', 'COMPLETED'].includes(o.status) &&
      !['DELIVERED', 'RETURNED'].includes(bts?.status ?? 'NOT_CREATED')
    )
      add('bts_update');

    if (o.carrier === 'PICKUP' && [...CLAIMABLE, 'HANDED_TO_COURIER'].includes(o.status))
      add('mark_delivered');

    if (o.status !== 'NEW' && o.status !== 'CANCELLED') add('record_receipt');
    if (o.status === 'DELIVERED' || o.status === 'RETURN_REQUESTED')
      add('complete', o.fiscalEvidence ? null : 'FISCAL_RECEIPT_REQUIRED');
    add('add_note');
  }

  if (can('orders.cancel_refund')) {
    if (CANCELLABLE.includes(o.status))
      add(
        'cancel',
        paid.length > 0
          ? 'ORDER_PAID_REFUND_FIRST'
          : parcelWithCarrier(o.shipments, now)
            ? 'DELIVERY_IN_PROGRESS'
            : null,
      );
    if (paid.length > 0 && orderAllowsRefund(o.status))
      add('refund', paid.every((p) => p.method === 'PAYME') ? 'REFUND_VIA_PROVIDER_CABINET' : null);
  }

  if (can('customers.pii') || can('customers.pii_partial')) add('reveal_pii');
  return out;
}
