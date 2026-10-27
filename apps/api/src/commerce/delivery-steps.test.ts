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

  it('never confirms an order and leaves closed ones alone', () => {
    for (const from of ['NEW', 'CANCELLED', 'COMPLETED', 'RETURN_REQUESTED', 'RETURNED'] as const)
      expect(deliveryOrderSteps(from, 'DELIVERED')).toEqual([]);
  });
});
