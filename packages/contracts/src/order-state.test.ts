import { describe, expect, it } from 'vitest';
import { DomainError, errorMessage } from './errors';
import {
  allowedDeliveryTransitions,
  assertDeliveryTransition,
  canTransitionDelivery,
  DELIVERY_STATUSES,
  allowedOrderTransitions,
  assertOrderTransition,
  assertPaymentTransition,
  canChangeAddress,
  canTransitionOrder,
  canTransitionPayment,
  formatOrderNumber,
  isOrderNumber,
  isTerminalOrderStatus,
  ORDER_STATUSES,
} from './order-state';

describe('order state machine', () => {
  it('allows the happy path', () => {
    const path = [
      'NEW',
      'CONFIRMED',
      'PACKING',
      'READY',
      'HANDED_TO_COURIER',
      'DELIVERED',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(canTransitionOrder(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('rejects skipping and leaving terminal states', () => {
    expect(canTransitionOrder('NEW', 'DELIVERED')).toBe(false);
    expect(canTransitionOrder('CANCELLED', 'NEW')).toBe(false);
    expect(canTransitionOrder('HANDED_TO_COURIER', 'CANCELLED')).toBe(false);
    // A parcel refused at the door is returned, it can never end up COMPLETED.
    expect(canTransitionOrder('HANDED_TO_COURIER', 'RETURNED')).toBe(true);
    expect(canTransitionOrder('HANDED_TO_COURIER', 'RETURN_REQUESTED')).toBe(false);
    expect(() => assertOrderTransition('RETURNED', 'COMPLETED')).toThrow(DomainError);
    try {
      assertOrderTransition('NEW', 'COMPLETED');
    } catch (e) {
      expect((e as DomainError).code).toBe('ORDER_INVALID_TRANSITION');
      expect((e as DomainError).httpStatus).toBe(409);
      expect((e as DomainError).details).toEqual({ from: 'NEW', to: 'COMPLETED' });
    }
  });

  it('every status has an edge list; terminal ones are empty', () => {
    for (const s of ORDER_STATUSES) expect(Array.isArray(allowedOrderTransitions(s))).toBe(true);
    expect(isTerminalOrderStatus('CANCELLED')).toBe(true);
    expect(isTerminalOrderStatus('RETURNED')).toBe(true);
    expect(isTerminalOrderStatus('NEW')).toBe(false);
  });

  it('locks address once handed to courier', () => {
    expect(canChangeAddress('READY')).toBe(true);
    expect(canChangeAddress('HANDED_TO_COURIER')).toBe(false);
  });

  it('payment transitions', () => {
    expect(canTransitionPayment('PENDING', 'PAID')).toBe(true);
    expect(canTransitionPayment('COD_PENDING', 'PAID')).toBe(true);
    expect(canTransitionPayment('PAID', 'PENDING')).toBe(false);
    expect(canTransitionPayment('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
    expect(() => assertPaymentTransition('EXPIRED', 'PAID')).toThrow(DomainError);
    expect(() => assertPaymentTransition('PENDING', 'EXPIRED')).not.toThrow();
  });

  it('order numbers', () => {
    expect(formatOrderNumber(10482)).toBe('F-10482');
    expect(formatOrderNumber(10001n)).toBe('F-10001');
    expect(isOrderNumber('F-10482')).toBe(true);
    expect(isOrderNumber('FR-240913')).toBe(false);
  });

  it('localizes error messages with variables', () => {
    expect(errorMessage('PROMO_MIN_CART', 'uz', { min: "300 000 so'm" })).toContain("300 000 so'm");
    expect(errorMessage('PROMO_MIN_CART', 'ru')).toContain('{min}');
  });

  it('delivery status only moves forward; FAILED can be retried', () => {
    expect(canTransitionDelivery('NOT_CREATED', 'CREATED')).toBe(true);
    expect(canTransitionDelivery('NOT_CREATED', 'DELIVERED')).toBe(false);
    // Polling may skip states.
    expect(canTransitionDelivery('CREATED', 'DELIVERED')).toBe(true);
    expect(canTransitionDelivery('PICKED_UP', 'AT_BRANCH')).toBe(true);
    expect(canTransitionDelivery('IN_TRANSIT', 'PICKED_UP')).toBe(false);
    expect(canTransitionDelivery('AT_BRANCH', 'RETURNED')).toBe(true);
    expect(canTransitionDelivery('FAILED', 'CREATED')).toBe(true);
    expect(canTransitionDelivery('FAILED', 'DELIVERED')).toBe(true);
    expect(canTransitionDelivery('IN_TRANSIT', 'IN_TRANSIT')).toBe(false);
    for (const s of DELIVERY_STATUSES) {
      expect(canTransitionDelivery(s, 'NOT_CREATED')).toBe(false);
      expect(canTransitionDelivery('DELIVERED', s)).toBe(false);
    }
    expect(allowedDeliveryTransitions('RETURNED')).toEqual([]);
    expect(() => assertDeliveryTransition('DELIVERED', 'FAILED')).toThrow(DomainError);
    expect(() => assertDeliveryTransition('CREATED', 'PICKED_UP')).not.toThrow();
  });
});
