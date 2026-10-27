import 'server-only';
import type { AddressDto, Locale, MeDto } from '@forest/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { ApiError, apiGet } from './api';

/**
 * Signed-in customer for this request (`fr_session` cookie), or null for guests and expired
 * sessions. Personal → the route renders dynamically and nothing is cached.
 */
export const getMe = cache(async (locale: Locale): Promise<MeDto | null> => {
  if (!(await cookies()).has('fr_session')) return null;
  try {
    return await apiGet<MeDto>('/me', locale, { personal: true });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
});

export async function getMyAddresses(locale: Locale): Promise<AddressDto[]> {
  try {
    return await apiGet<AddressDto[]>('/me/addresses', locale, { personal: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return [];
    throw e;
  }
}
