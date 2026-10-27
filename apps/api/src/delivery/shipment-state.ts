import type { DeliveryStatus } from '@forest/contracts';
import { isYandexTerminal } from '../integrations/providers/yandex-delivery';

/**
 * Pure facts about a shipment row that commerce (cancel/refund/address) and delivery services
 * both decide on. Kept free of Nest/Prisma so the rules are unit-tested in one place.
 */
export interface ShipmentFacts {
  carrier: string;
  externalId: string | null;
  status: DeliveryStatus;
  providerStatus: string | null;
  acceptedAt: Date | null;
  providerData?: unknown;
}

/** A staff accept in flight (`providerData.acceptRequest`) blocks a second one for this long. */
export const ACCEPT_LEASE_MS = 2 * 60_000;

export interface AcceptRequest {
  by: string | null;
  at: string;
  claimId: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function readAcceptRequest(providerData: unknown): AcceptRequest | null {
  const r = isObj(providerData) ? providerData.acceptRequest : null;
  if (!isObj(r) || typeof r.at !== 'string' || typeof r.claimId !== 'string') return null;
  return { by: typeof r.by === 'string' ? r.by : null, at: r.at, claimId: r.claimId };
}

/** An accept for the current claim started less than `ACCEPT_LEASE_MS` ago (outcome unknown). */
export function acceptPending(s: ShipmentFacts, now: Date): boolean {
  const r = readAcceptRequest(s.providerData);
  return Boolean(
    r && r.claimId === s.externalId && now.getTime() - Date.parse(r.at) < ACCEPT_LEASE_MS,
  );
}

/** A Yandex claim that can never move again before pickup: staff may create a new one. */
export function yandexClaimDead(
  s: Pick<ShipmentFacts, 'externalId' | 'status' | 'providerStatus'>,
) {
  return !s.externalId || (s.status === 'FAILED' && isYandexTerminal(s.providerStatus ?? 'failed'));
}

function pendingRequestId(providerData: unknown): boolean {
  return isObj(providerData) && typeof providerData.pendingRequestId === 'string';
}

/**
 * Yandex already has (or may have) the destination: a claim that isn't dead, or a create whose
 * answer was lost — the retry reuses its request_id, so Yandex returns the claim with the address
 * it got first.
 */
export function yandexClaimLive(s: ShipmentFacts): boolean {
  return s.carrier === 'YANDEX' && (!yandexClaimDead(s) || pendingRequestId(s.providerData));
}

/** Carrier statuses at which a courier is coming for, or has, the parcel. */
const WITH_CARRIER: readonly DeliveryStatus[] = [
  'COURIER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_BRANCH',
  'DELIVERED',
];

/**
 * The parcel is with a carrier or a courier is dispatched for it: the order must not be cancelled
 * (stock released, money returned) until staff cancel the claim / the parcel comes back.
 * Yandex: accepted (or being accepted) and not dead. Any carrier: COURIER_ASSIGNED…DELIVERED.
 */
export function parcelWithCarrier(shipments: readonly ShipmentFacts[], now: Date): boolean {
  return shipments.some(
    (s) =>
      WITH_CARRIER.includes(s.status) ||
      (s.carrier === 'YANDEX' &&
        !yandexClaimDead(s) &&
        (s.acceptedAt !== null || acceptPending(s, now))),
  );
}
