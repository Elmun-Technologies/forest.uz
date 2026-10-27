import { DomainError } from './errors';

export const ORDER_STATUSES = [
  'NEW',
  'CONFIRMED',
  'PACKING',
  'READY',
  'HANDED_TO_COURIER',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'COD_PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_STATUSES = [
  'NOT_CREATED',
  'CREATED',
  'COURIER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_BRANCH',
  'DELIVERED',
  'FAILED',
  'RETURNED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PAYMENT_METHODS = ['PAYME', 'CLICK', 'COD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const ORDER_EDGES: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKING', 'CANCELLED'],
  PACKING: ['READY', 'CANCELLED'],
  READY: ['HANDED_TO_COURIER', 'CANCELLED'],
  // Refused at the door → parcel goes back to the warehouse (never "completed").
  HANDED_TO_COURIER: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['COMPLETED', 'RETURN_REQUESTED'],
  COMPLETED: ['RETURN_REQUESTED'],
  CANCELLED: [],
  // A rejected return request closes the order as completed.
  RETURN_REQUESTED: ['RETURNED', 'COMPLETED'],
  RETURNED: [],
};

const PAYMENT_EDGES: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  // Customer may retry another method after a failure (new attempt on the same payment row).
  FAILED: ['PENDING', 'PAID', 'EXPIRED'],
  COD_PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  EXPIRED: [],
  REFUNDED: [],
};

/**
 * Carrier delivery status (docs/02). Forward-only; carriers' polling may skip states. FAILED is an
 * attempt that can be retried (re-created claim, redelivery, parcel left at a branch);
 * DELIVERED and RETURNED are final.
 */
const DELIVERY_EDGES: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  NOT_CREATED: ['CREATED'],
  CREATED: ['COURIER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'AT_BRANCH', 'DELIVERED', 'FAILED'],
  COURIER_ASSIGNED: ['PICKED_UP', 'IN_TRANSIT', 'AT_BRANCH', 'DELIVERED', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'AT_BRANCH', 'DELIVERED', 'FAILED'],
  IN_TRANSIT: ['AT_BRANCH', 'DELIVERED', 'FAILED'],
  // Not collected from the branch within the storage period → back to the warehouse.
  AT_BRANCH: ['DELIVERED', 'FAILED', 'RETURNED'],
  FAILED: ['CREATED', 'IN_TRANSIT', 'AT_BRANCH', 'DELIVERED', 'RETURNED'],
  DELIVERED: [],
  RETURNED: [],
};

export function allowedDeliveryTransitions(from: DeliveryStatus): readonly DeliveryStatus[] {
  return DELIVERY_EDGES[from];
}

/** Same status is not a transition (callers treat it as a no-op update). */
export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_EDGES[from].includes(to);
}

export function assertDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!canTransitionDelivery(from, to)) {
    throw new DomainError('DELIVERY_INVALID_TRANSITION', { from, to });
  }
}

export function allowedOrderTransitions(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_EDGES[from];
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_EDGES[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new DomainError('ORDER_INVALID_TRANSITION', { from, to });
  }
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_EDGES[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new DomainError('PAYMENT_INVALID_TRANSITION', { from, to });
  }
}

/** Customer can change the address until the parcel is handed to the courier. */
export function canChangeAddress(status: OrderStatus): boolean {
  return ['NEW', 'CONFIRMED', 'PACKING', 'READY'].includes(status);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_EDGES[status].length === 0;
}

/** Order public number: `F-10482`. */
export function formatOrderNumber(seq: number | bigint): string {
  return `F-${seq.toString()}`;
}

export function isOrderNumber(value: string): boolean {
  return /^F-\d{5,}$/.test(value);
}
