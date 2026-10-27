import {
  formatAmount,
  MOYSKLAD_MIRRORED_STATUSES,
  MOYSKLAD_PUSH_STATUSES,
  type MoyskladMirroredStatus,
  type MoyskladSettings,
  type OrderStatus,
} from '@forest/contracts';

/** Pure order → MoySklad rules (push eligibility, state mapping, positions, retry backoff). */

export function isPushStatus(status: OrderStatus): boolean {
  return (MOYSKLAD_PUSH_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Statuses after which the MoySklad reserve must be dropped (goods stay in the warehouse). */
const RELEASE_RESERVE: readonly OrderStatus[] = ['CANCELLED', 'RETURNED'];

export interface StateChange {
  /** MoySklad state name to set; null = leave the state (mapping empty for this status). */
  stateName: string | null;
  clearReserve: boolean;
}

export function stateChangeFor(status: OrderStatus, settings: MoyskladSettings): StateChange {
  const mirrored = (MOYSKLAD_MIRRORED_STATUSES as readonly OrderStatus[]).includes(status);
  const name = mirrored ? settings.stateMap[status as MoyskladMirroredStatus].trim() : '';
  return {
    stateName: name || null,
    clearReserve: settings.reserve && RELEASE_RESERVE.includes(status),
  };
}

/** Line discount as MoySklad's position percentage (2 decimals). */
export function discountPercent(priceTiyin: bigint, qty: number, discountTiyin: bigint): number {
  const gross = priceTiyin * BigInt(qty);
  if (gross <= 0n || discountTiyin <= 0n) return 0;
  const basisPoints = Number((discountTiyin * 10_000n + gross / 2n) / gross);
  return Math.min(100, basisPoints / 100);
}

/** Order comment in MoySklad: no address or name (data minimisation, docs/13). */
export function orderDescription(order: {
  number: string;
  paymentMethod: string;
  deliveryZone: string;
  carrier: string;
  shippingTiyin: bigint;
  discountTiyin: bigint;
  promoCode: string | null;
  totalTiyin: bigint;
}): string {
  const parts = [
    `Forest sayt buyurtmasi ${order.number}`,
    `To'lov: ${order.paymentMethod}`,
    `Yetkazish: ${order.deliveryZone} (${order.carrier}), ${formatAmount(order.shippingTiyin)} so'm`,
    order.discountTiyin > 0n
      ? `Chegirma: ${formatAmount(order.discountTiyin)} so'm${order.promoCode ? ` (${order.promoCode})` : ''}`
      : null,
    `Jami: ${formatAmount(order.totalTiyin)} so'm`,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Retry backoff for a failing push/state update: 1 min, 2, 4 … capped at 1 h. */
export function pushBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}
