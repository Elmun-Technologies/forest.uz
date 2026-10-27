import type { OrderPublicDto, TrackingDto } from '@forest/contracts';

/** Carrier states in which the order page asks for the tracking read model (courier, history). */
export const CARRIER_ACTIVE = new Set<TrackingDto['deliveryStatus']>([
  'COURIER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_BRANCH',
  'DELIVERED',
  'FAILED',
  'RETURNED',
]);

/** The API masks the courier's forwarded number for anyone but the order owner. */
export const isMasked = (phone: string) => phone.includes('*');

/** `tel:` target: digits only, the extension after a dial pause (`,`) — works on iOS and Android. */
export function telHref(phone: string, ext: string | null): string {
  const dial = phone.replace(/[^\d+]/g, '');
  const extension = ext?.replace(/\D/g, '');
  return `tel:${dial}${extension ? `,${extension}` : ''}`;
}

/** Branch where a BTS parcel waits: the place of the latest AT_BRANCH history entry. */
export function waitingBranch(o: Pick<TrackingDto, 'deliveryStatus' | 'history'>): string | null {
  if (o.deliveryStatus !== 'AT_BRANCH') return null;
  const entry = [...o.history].reverse().find((h) => h.status === 'AT_BRANCH' && h.place);
  return entry?.place ?? null;
}

/** Token of the order's tracking link (`APP_URL/t/<token>`), or null if the URL is unexpected. */
export function trackingToken(o: Pick<OrderPublicDto, 'trackingUrl'>): string | null {
  const m = /\/t\/([A-Za-z0-9_-]{6,40})\/?$/.exec(o.trackingUrl);
  return m?.[1] ?? null;
}
