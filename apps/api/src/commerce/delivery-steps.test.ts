import { manualShipmentNotices } from '../delivery/manual-shipment.service';
import { deliveryOrderSteps, orderTargetForDelivery } from './order-lifecycle.service';

describe('order steps implied by a delivery status', () => {
  it('maps carrier statuses to fulfilment targets', () => {
    expect(orderTargetForDelivery('CREATED')).toBeNull();
    expect(orderTargetForDelivery('COURIER_ASSIGNED')).toBeNull();
    expect(orderTargetForDelivery('FAILED')).toBeNull();
    expect(orderTargetForDelivery('PICKED_UP')).toBe('HANDED_TO_COURIER');
    expect(orderTargetForDelivery('AT_BRANCH')).toBe('HANDED_TO_COURIER');
    expect(orderTargetForDelivery('DELIVERED')).toBe('DELIVERED');
    expect(orderTargetForDelivery('RETURNED')).toBe('RETURNED');
  });

  it('walks every intermediate status, never backwards', () => {
    expect(deliveryOrderSteps('CONFIRMED', 'PICKED_UP')).toEqual([
      'PACKING',
      'READY',
      'HANDED_TO_COURIER',
    ]);
    expect(deliveryOrderSteps('READY', 'DELIVERED')).toEqual(['HANDED_TO_COURIER', 'DELIVERED']);
    expect(deliveryOrderSteps('HANDED_TO_COURIER', 'IN_TRANSIT')).toEqual([]);
    expect(deliveryOrderSteps('DELIVERED', 'IN_TRANSIT')).toEqual([]);
    expect(deliveryOrderSteps('PACKING', 'RETURNED')).toEqual([
      'READY',
      'HANDED_TO_COURIER',
      'RETURNED',
    ]);
    expect(deliveryOrderSteps('HANDED_TO_COURIER', 'RETURNED')).toEqual(['RETURNED']);
    expect(deliveryOrderSteps('DELIVERED', 'RETURNED')).toEqual([]);
  });

  it('a FAILED status that proves hand-over walks the order to HANDED_TO_COURIER', () => {
    expect(orderTargetForDelivery('FAILED', true)).toBe('HANDED_TO_COURIER');
    expect(deliveryOrderSteps('READY', 'FAILED')).toEqual([]);
    expect(deliveryOrderSteps('CONFIRMED', 'FAILED', true)).toEqual([
      'PACKING',
      'READY',
      'HANDED_TO_COURIER',
    ]);
    expect(deliveryOrderSteps('HANDED_TO_COURIER', 'FAILED', true)).toEqual([]);
  });

  it('never confirms an order and leaves closed ones alone', () => {
    for (const from of ['NEW', 'CANCELLED', 'COMPLETED', 'RETURN_REQUESTED', 'RETURNED'] as const)
      expect(deliveryOrderSteps(from, 'DELIVERED')).toEqual([]);
  });
});

describe('BTS service SMS', () => {
  const vars = { trek: 'BTS-1', filial: 'Samarqand 3' };
  const handed = { orderStatus: 'HANDED_TO_COURIER' as const, failedNoticeSent: false };
  const templates = (...a: Parameters<typeof manualShipmentNotices>) =>
    manualShipmentNotices(...a).map((n) => n.template);

  it('"shipped" only while the parcel is on its way', () => {
    const steps = ['PACKING', 'READY', 'HANDED_TO_COURIER'] as const;
    expect(templates('PICKED_UP', steps, vars, handed)).toEqual(['order_shipped_bts']);
    expect(templates('AT_BRANCH', steps, vars, handed)).toEqual([
      'order_shipped_bts',
      'order_at_branch',
    ]);
    // A first entry straight to DELIVERED / a return never says "shipped".
    expect(
      templates('DELIVERED', [...steps, 'DELIVERED'], vars, {
        ...handed,
        orderStatus: 'DELIVERED',
      }),
    ).toEqual(['order_delivered']);
    expect(
      templates('RETURNED', [...steps, 'RETURNED'], vars, { ...handed, orderStatus: 'RETURNED' }),
    ).toEqual([]);
  });

  it('"failed" once, and only when BTS had the parcel', () => {
    expect(templates('FAILED', [], vars, handed)).toEqual(['order_delivery_failed']);
    expect(templates('FAILED', [], vars, { ...handed, failedNoticeSent: true })).toEqual([]);
    expect(templates('FAILED', [], vars, { ...handed, orderStatus: 'READY' })).toEqual([]);
  });
});
