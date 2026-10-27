import { parseMoyskladSettings } from '@forest/contracts';
import { mergeMoyskladSettings } from '../admin/moysklad/admin-moysklad.service';
import {
  discountPercent,
  isPushStatus,
  orderDescription,
  pushBackoffMs,
  stateChangeFor,
} from './order-plan';

const settings = parseMoyskladSettings({});

describe('order → MoySklad rules', () => {
  it('pushes confirmed orders only (never NEW, cancelled or returns)', () => {
    expect(isPushStatus('NEW')).toBe(false);
    expect(isPushStatus('CONFIRMED')).toBe(true);
    expect(isPushStatus('DELIVERED')).toBe(true);
    expect(isPushStatus('CANCELLED')).toBe(false);
    expect(isPushStatus('RETURN_REQUESTED')).toBe(false);
  });

  it('maps statuses to configured state names and drops the reserve on cancel/return', () => {
    expect(stateChangeFor('CONFIRMED', settings)).toEqual({
      stateName: 'Подтвержден',
      clearReserve: false,
    });
    expect(stateChangeFor('CANCELLED', settings)).toEqual({
      stateName: 'Отменен',
      clearReserve: true,
    });
    expect(stateChangeFor('RETURN_REQUESTED', settings)).toEqual({
      stateName: null,
      clearReserve: false,
    });
    const custom = parseMoyskladSettings({
      reserve: false,
      stateMap: { HANDED_TO_COURIER: '  Yo‘lda ', RETURNED: '' },
    });
    expect(stateChangeFor('HANDED_TO_COURIER', custom).stateName).toBe('Yo‘lda');
    expect(stateChangeFor('RETURNED', custom)).toEqual({ stateName: null, clearReserve: false });
    expect(stateChangeFor('NEW', settings).stateName).toBeNull();
  });

  it('expresses line discounts as a percentage with 2 decimals', () => {
    expect(discountPercent(10_000_000n, 3, 3_000_000n)).toBe(10);
    expect(discountPercent(10_000_000n, 3, 1_000_000n)).toBe(3.33);
    expect(discountPercent(10_000_000n, 1, 0n)).toBe(0);
    expect(discountPercent(0n, 1, 5n)).toBe(0);
  });

  it('backs off 1 min → 1 h', () => {
    expect(pushBackoffMs(1)).toBe(60_000);
    expect(pushBackoffMs(3)).toBe(240_000);
    expect(pushBackoffMs(20)).toBe(3_600_000);
  });

  it('describes the order without name, phone or address', () => {
    const d = orderDescription({
      number: 'F-10482',
      paymentMethod: 'PAYME',
      deliveryZone: 'tashkent',
      carrier: 'YANDEX',
      shippingTiyin: 3_000_000n,
      discountTiyin: 1_000_000n,
      promoCode: 'SALOM10',
      totalTiyin: 55_020_000n,
    });
    expect(d).toContain('F-10482');
    expect(d).toContain('SALOM10');
    expect(d).not.toMatch(/\+998/);
  });
});

describe('mergeMoyskladSettings', () => {
  const now = new Date('2026-10-27T10:00:00Z');

  it('merges flows and the state map; switching orders on starts pushSince', () => {
    const off = parseMoyskladSettings({ flows: { orders: false } });
    const next = mergeMoyskladSettings(
      off,
      { flows: { orders: true, webhooks: true }, stateMap: { CONFIRMED: 'Yangi' } },
      now,
    );
    expect(next.flows).toMatchObject({ orders: true, webhooks: true, products: true });
    expect(next.stateMap.CONFIRMED).toBe('Yangi');
    expect(next.stateMap.CANCELLED).toBe('Отменен');
    expect(next.pushSince).toBe(now.toISOString());
    const later = mergeMoyskladSettings(next, { priceType: 'Narx' }, new Date());
    expect(later.pushSince).toBe(now.toISOString());
    expect(later.priceType).toBe('Narx');
  });
});
