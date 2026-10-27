import type { DeliveryStatus } from '@forest/contracts';
import { mergeCourier, type StoredCourier } from './yandex-shipment.service';
import {
  ACCEPT_LEASE_MS,
  acceptPending,
  parcelWithCarrier,
  type ShipmentFacts,
  yandexClaimLive,
} from './shipment-state';

const now = new Date('2026-10-27T08:00:00Z');
const yandex = (over: Partial<ShipmentFacts> = {}): ShipmentFacts => ({
  carrier: 'YANDEX',
  externalId: 'claim-1',
  status: 'CREATED',
  providerStatus: 'ready_for_approval',
  acceptedAt: null,
  providerData: {},
  ...over,
});

describe('parcel with carrier (cancel / full refund guard)', () => {
  it('an estimated, never accepted claim does not block', () => {
    expect(parcelWithCarrier([yandex()], now)).toBe(false);
    expect(parcelWithCarrier([], now)).toBe(false);
  });

  it('an accepted claim blocks until it is dead', () => {
    const accepted = yandex({ acceptedAt: now, providerStatus: 'performer_lookup' });
    expect(parcelWithCarrier([accepted], now)).toBe(true);
    // Returning (FAILED, not terminal): the parcel is still with the courier.
    expect(
      parcelWithCarrier([{ ...accepted, status: 'FAILED', providerStatus: 'returning' }], now),
    ).toBe(true);
    expect(
      parcelWithCarrier([{ ...accepted, status: 'FAILED', providerStatus: 'cancelled' }], now),
    ).toBe(false);
  });

  it('an accept in flight blocks for the lease only, and only for the current claim', () => {
    const at = new Date(now.getTime() - 30_000).toISOString();
    const pending = yandex({
      providerData: { acceptRequest: { by: 's1', at, claimId: 'claim-1' } },
    });
    expect(acceptPending(pending, now)).toBe(true);
    expect(parcelWithCarrier([pending], now)).toBe(true);
    expect(parcelWithCarrier([pending], new Date(now.getTime() + ACCEPT_LEASE_MS))).toBe(false);
    const other = yandex({ providerData: { acceptRequest: { by: 's1', at, claimId: 'old' } } });
    expect(acceptPending(other, now)).toBe(false);
  });

  it('any carrier from COURIER_ASSIGNED to DELIVERED blocks; BTS booked or failed does not', () => {
    const bts = (status: DeliveryStatus): ShipmentFacts => ({
      carrier: 'BTS',
      externalId: 'BTS-1',
      status,
      providerStatus: null,
      acceptedAt: null,
    });
    for (const s of [
      'COURIER_ASSIGNED',
      'PICKED_UP',
      'IN_TRANSIT',
      'AT_BRANCH',
      'DELIVERED',
    ] as const)
      expect(parcelWithCarrier([bts(s)], now)).toBe(true);
    for (const s of ['NOT_CREATED', 'CREATED', 'FAILED', 'RETURNED'] as const)
      expect(parcelWithCarrier([bts(s)], now)).toBe(false);
  });
});

describe('live Yandex claim (address lock)', () => {
  it('counts a claim that is not dead and a create whose answer was lost', () => {
    expect(yandexClaimLive(yandex())).toBe(true);
    expect(yandexClaimLive(yandex({ status: 'FAILED', providerStatus: 'cancelled' }))).toBe(false);
    const lost = yandex({ externalId: null, status: 'NOT_CREATED', providerStatus: null });
    expect(yandexClaimLive(lost)).toBe(false);
    expect(yandexClaimLive({ ...lost, providerData: { pendingRequestId: 'shp-1' } })).toBe(true);
    expect(yandexClaimLive({ ...yandex(), carrier: 'BTS' })).toBe(false);
  });
});

describe('courier merge', () => {
  const prev: StoredCourier = {
    name: 'Aziz Karimov',
    phone: '+79099999998',
    phoneExt: '0163',
    phoneExpiresAt: new Date(now.getTime() + 600_000).toISOString(),
    car: 'oq Damas',
    plate: '01 A 123 BC',
    transport: null,
    etaAt: '2026-10-27T09:40:00.000Z',
    distanceKm: null,
  };
  const info = (name: string, plate: string) => ({
    name,
    phone: null,
    car: null,
    plate,
    etaAt: null,
    distanceKm: null,
  });

  it('keeps a valid forwarded number for the same courier', () => {
    expect(mergeCourier(prev, info('Aziz Karimov', '01 A 123 BC'), now)).toMatchObject({
      phone: '+79099999998',
      phoneExt: '0163',
      etaAt: prev.etaAt,
    });
  });

  it('drops the number and ETA when another courier takes the claim', () => {
    for (const next of [info('Bobur Aliyev', '01 A 123 BC'), info('Aziz Karimov', '01 B 777 AA')])
      expect(mergeCourier(prev, next, now)).toMatchObject({
        phone: null,
        phoneExt: null,
        phoneExpiresAt: null,
        etaAt: null,
      });
  });
});
