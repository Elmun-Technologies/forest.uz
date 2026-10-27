'use client';

import type { DeliveryOptionDto } from '@forest/contracts';
import { tashkentDayDiff, formatTashkentHm } from '@forest/contracts/core';
import { useEffect, useState } from 'react';
import { clientApi } from '@/lib/client-api';

/** Region chosen on the cart page, preselected on checkout (per tab, no PII). */
export const REGION_KEY = 'fr_region';

export function readRegion(): string | null {
  try {
    return sessionStorage.getItem(REGION_KEY);
  } catch {
    return null;
  }
}

export function storeRegion(region: string) {
  try {
    sessionStorage.setItem(REGION_KEY, region);
  } catch {
    /* storage disabled */
  }
}

/**
 * Delivery options for a region/district (GET /cart/quote). Re-quotes when `revision` changes
 * (cart subtotal) because free-shipping thresholds depend on it. `null` region = nothing to quote.
 * `pin` (checkout geolocation, only once the visitor granted it) lets zones with a live carrier
 * quote price the trip; without it the API answers with the zone price.
 */
export function useDeliveryQuote(
  region: string | null,
  district: string | null,
  revision: unknown,
  pin: { lat: number; lng: number } | null = null,
) {
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  const [state, setState] = useState<{
    options: DeliveryOptionDto[];
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ options: [], status: 'idle' });

  useEffect(() => {
    if (!region) {
      setState({ options: [], status: 'idle' });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    clientApi.cart
      .quote(region, district, lat !== null && lng !== null ? { lat, lng } : null)
      .then((options) => live && setState({ options, status: 'ready' }))
      .catch(() => live && setState({ options: [], status: 'error' }));
    return () => {
      live = false;
    };
  }, [region, district, revision, lat, lng]);

  return state;
}

export type Eta = { kind: 'today' | 'tomorrow'; time: string } | { kind: 'generic' };

/** "bugun 22:40 gacha" / "ertaga 12:00 gacha" from the quote's promise deadline. */
export function optionEta(option: DeliveryOptionDto, now = new Date()): Eta {
  const at = new Date(option.promiseAt);
  const diff = tashkentDayDiff(now, at);
  if (diff === 0) return { kind: 'today', time: formatTashkentHm(at) };
  if (diff === 1) return { kind: 'tomorrow', time: formatTashkentHm(at) };
  return { kind: 'generic' };
}
