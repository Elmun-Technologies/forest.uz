import { describe, expect, it } from 'vitest';
import { isMasked, telHref, trackingToken, waitingBranch } from './carrier';

describe('carrier helpers', () => {
  it('builds a tel: link with the extension after a dial pause', () => {
    expect(telHref('+7 (900) 123-45-67', '4321')).toBe('tel:+79001234567,4321');
    expect(telHref('+998 90 111 22 33', null)).toBe('tel:+998901112233');
    expect(telHref('+998901112233', '')).toBe('tel:+998901112233');
  });

  it('recognizes the masked courier number', () => {
    expect(isMasked('+998 90 *** ** 33')).toBe(true);
    expect(isMasked('+7 *** *** 67')).toBe(true);
    expect(isMasked('+998901112233')).toBe(false);
  });

  it('finds the branch of the latest AT_BRANCH entry only while the parcel waits there', () => {
    const history = [
      {
        at: '2026-10-26T14:05:00Z',
        place: 'Toshkent BTS',
        note: 'Qabul qilindi',
        status: 'IN_TRANSIT' as const,
      },
      {
        at: '2026-10-27T03:40:00Z',
        place: 'BTS Samarqand · 3-filial',
        note: 'Filialda',
        status: 'AT_BRANCH' as const,
      },
    ];
    expect(waitingBranch({ deliveryStatus: 'AT_BRANCH', history })).toBe(
      'BTS Samarqand · 3-filial',
    );
    expect(waitingBranch({ deliveryStatus: 'DELIVERED', history })).toBeNull();
    expect(waitingBranch({ deliveryStatus: 'AT_BRANCH', history: history.slice(0, 1) })).toBeNull();
  });

  it('extracts the tracking token from the absolute tracking URL', () => {
    expect(trackingToken({ trackingUrl: 'https://forest.uz/t/AbC_12-xyz' })).toBe('AbC_12-xyz');
    expect(trackingToken({ trackingUrl: 'https://forest.uz/buyurtma/x' })).toBeNull();
  });
});
