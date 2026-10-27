import { describe, expect, it } from 'vitest';
import { MOYSKLAD_DEFAULT_STATE_MAP } from './admin-moysklad';
import { moyskladSettingsPatchSchema, parseMoyskladSettings } from './schemas/admin-moysklad';

const ID = '5427bc76-b95f-11eb-0a80-04bb000cd583';

describe('MoySklad settings schema', () => {
  it('fills defaults for an empty or missing config', () => {
    for (const raw of [undefined, null, {}, [], 'x']) {
      const s = parseMoyskladSettings(raw);
      expect(s.priceType).toBe('Chakana');
      expect(s.ikpuAttribute).toBe('ikpu');
      expect(s.stockPollMinutes).toBe(5);
      expect(s.reserve).toBe(true);
      expect(s.flows).toEqual({
        products: true,
        prices: true,
        stock: true,
        orders: true,
        customers: true,
        statuses: true,
        webhooks: false,
      });
      expect(s.stateMap).toEqual(MOYSKLAD_DEFAULT_STATE_MAP);
      expect(s.pushSince).toBeNull();
    }
  });

  it('replaces bad stored values with defaults instead of failing', () => {
    const s = parseMoyskladSettings({
      storeId: 'not-an-id',
      stockPollMinutes: 0,
      flows: { stock: 'yes', orders: false },
      priceType: '',
    });
    expect(s.storeId).toBeNull();
    expect(s.stockPollMinutes).toBe(5);
    expect(s.priceType).toBe('Chakana');
    expect(s.flows.orders).toBe(true);
  });

  it('accepts real MoySklad ids (no RFC variant bits) and keeps valid values', () => {
    const s = parseMoyskladSettings({ storeId: ID.toUpperCase(), flows: { orders: false } });
    expect(s.storeId).toBe(ID);
    expect(s.flows.orders).toBe(false);
  });

  it('patch: strict keys, empty id clears, pushSince is not client-settable', () => {
    expect(moyskladSettingsPatchSchema.parse({ storeId: '' })).toEqual({ storeId: null });
    expect(moyskladSettingsPatchSchema.safeParse({ pushSince: null }).success).toBe(false);
    expect(moyskladSettingsPatchSchema.safeParse({ flows: { bogus: true } }).success).toBe(false);
    expect(moyskladSettingsPatchSchema.safeParse({ stockPollMinutes: 61 }).success).toBe(false);
  });
});
