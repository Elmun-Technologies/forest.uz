import { ROLE_PERMISSIONS } from '@forest/contracts';
import type { ShipmentFacts } from '../../delivery/shipment-state';
import { type OrderFacts, orderActions } from './order-actions';

const now = new Date('2026-10-27T08:00:00Z');
const OWNER = ROLE_PERMISSIONS.OWNER;
const WAREHOUSE = ROLE_PERMISSIONS.WAREHOUSE;
const OPERATOR = ROLE_PERMISSIONS.OPERATOR;

const ship = (over: Partial<ShipmentFacts> = {}): ShipmentFacts => ({
  carrier: 'YANDEX',
  externalId: null,
  status: 'NOT_CREATED',
  providerStatus: null,
  acceptedAt: null,
  providerData: {},
  ...over,
});

const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  status: 'NEW',
  carrier: 'YANDEX',
  payments: [{ method: 'COD', status: 'COD_PENDING' }],
  shipments: [ship()],
  fiscalEvidence: false,
  ...over,
});

const keys = (f: OrderFacts, perms = OWNER) => orderActions(f, perms, now).map((a) => a.key);
const blocked = (f: OrderFacts, key: string, perms = OWNER) =>
  orderActions(f, perms, now).find((a) => a.key === key)?.blockedBy;

describe('orderActions', () => {
  it('new COD order: confirm, cancel, note, PII; no packing yet', () => {
    expect(keys(facts())).toEqual(['confirm_cod', 'add_note', 'cancel', 'reveal_pii']);
  });

  it('online unpaid order is not confirmed by staff (the webhook pays it)', () => {
    const k = keys(facts({ payments: [{ method: 'PAYME', status: 'PENDING' }] }));
    expect(k).not.toContain('confirm_cod');
    expect(k).toContain('cancel');
  });

  it('fulfilment steps follow the order status', () => {
    expect(keys(facts({ status: 'CONFIRMED' }))).toContain('start_packing');
    expect(keys(facts({ status: 'PACKING' }))).toContain('mark_ready');
    expect(keys(facts({ status: 'READY' }))).not.toContain('mark_ready');
  });

  it('Yandex: create → accept (only when ready_for_approval) → cancel before pickup', () => {
    expect(keys(facts({ status: 'READY' }))).toContain('yandex_create_claim');
    const estimating = ship({ externalId: 'c1', status: 'CREATED', providerStatus: 'estimating' });
    expect(
      blocked(facts({ status: 'READY', shipments: [estimating] }), 'yandex_accept_claim'),
    ).toBe('DELIVERY_CLAIM_NOT_READY');
    const ready = { ...estimating, providerStatus: 'ready_for_approval' };
    const f = facts({ status: 'READY', shipments: [ready] });
    expect(keys(f)).toEqual(
      expect.arrayContaining(['yandex_accept_claim', 'yandex_cancel_claim', 'yandex_refresh']),
    );
    expect(keys(f)).not.toContain('yandex_create_claim');
    const accepted = { ...ready, acceptedAt: now, providerStatus: 'performer_found' };
    const af = facts({ status: 'READY', shipments: [{ ...accepted, status: 'COURIER_ASSIGNED' }] });
    expect(keys(af)).not.toContain('yandex_accept_claim');
    expect(blocked(af, 'cancel')).toBe('DELIVERY_IN_PROGRESS');
    const picked = facts({
      status: 'HANDED_TO_COURIER',
      shipments: [{ ...accepted, status: 'PICKED_UP', providerStatus: 'pickuped' }],
    });
    expect(keys(picked)).not.toContain('yandex_cancel_claim');
    expect(keys(picked)).not.toContain('cancel');
  });

  it('a pending accept hides a second accept', () => {
    const s = ship({
      externalId: 'c1',
      status: 'CREATED',
      providerStatus: 'ready_for_approval',
      providerData: { acceptRequest: { by: 's', at: now.toISOString(), claimId: 'c1' } },
    });
    expect(keys(facts({ status: 'READY', shipments: [s] }))).not.toContain('yandex_accept_claim');
  });

  it('a dead claim after pickup can be marked returned', () => {
    const s = ship({ externalId: 'c1', status: 'FAILED', providerStatus: 'failed' });
    expect(keys(facts({ status: 'HANDED_TO_COURIER', shipments: [s] }))).toContain(
      'yandex_mark_returned',
    );
  });

  it('BTS manual updates until the parcel is final; PICKUP gets mark delivered', () => {
    const bts = (status: ShipmentFacts['status']) =>
      facts({ status: 'READY', carrier: 'BTS', shipments: [ship({ carrier: 'BTS', status })] });
    expect(keys(bts('NOT_CREATED'))).toContain('bts_update');
    expect(keys(bts('DELIVERED'))).not.toContain('bts_update');
    expect(keys(facts({ carrier: 'BTS', shipments: [ship({ carrier: 'BTS' })] }))).not.toContain(
      'bts_update',
    );
    expect(keys(facts({ status: 'READY', carrier: 'PICKUP', shipments: [] }))).toContain(
      'mark_delivered',
    );
  });

  it('COD cash is settled only after hand-over', () => {
    expect(keys(facts({ status: 'READY' }))).not.toContain('cod_settled');
    expect(keys(facts({ status: 'DELIVERED' }))).toContain('cod_settled');
    const paid = facts({ status: 'DELIVERED', payments: [{ method: 'COD', status: 'PAID' }] });
    expect(keys(paid)).not.toContain('cod_settled');
  });

  it('complete needs fiscal evidence', () => {
    expect(blocked(facts({ status: 'DELIVERED' }), 'complete')).toBe('FISCAL_RECEIPT_REQUIRED');
    expect(blocked(facts({ status: 'DELIVERED', fiscalEvidence: true }), 'complete')).toBeNull();
  });

  it('paid orders: cancel goes through a refund; Payme refunds happen in the cabinet', () => {
    const payme = facts({ status: 'CONFIRMED', payments: [{ method: 'PAYME', status: 'PAID' }] });
    expect(blocked(payme, 'cancel')).toBe('ORDER_PAID_REFUND_FIRST');
    expect(blocked(payme, 'refund')).toBe('REFUND_VIA_PROVIDER_CABINET');
    const click = facts({ status: 'CONFIRMED', payments: [{ method: 'CLICK', status: 'PAID' }] });
    expect(blocked(click, 'refund')).toBeNull();
    // With the courier (refund only after the parcel is back).
    expect(keys({ ...click, status: 'HANDED_TO_COURIER' })).not.toContain('refund');
  });

  it('permissions: Warehouse works the order but never cancels/refunds; Operator same', () => {
    const f = facts({ status: 'CONFIRMED', payments: [{ method: 'CLICK', status: 'PAID' }] });
    for (const perms of [WAREHOUSE, OPERATOR]) {
      const k = keys(f, perms);
      expect(k).toContain('start_packing');
      expect(k).not.toContain('refund');
      expect(k).not.toContain('cancel');
      expect(k).toContain('reveal_pii');
    }
    expect(keys(f, ROLE_PERMISSIONS.MARKETER)).toEqual([]);
  });
});
