import { describe, expect, it } from 'vitest';
import {
  computeDeliveryPromise,
  pickZone,
  shippingPriceSoum,
  slaState,
  type DeliveryRule,
  type DeliveryZone,
} from './delivery';
import { formatTashkentHm, fromTashkent, toTashkentParts } from './time';

const tashkentExpress: DeliveryRule = {
  promiseHours: 12,
  cutoff: '18:00',
  sameDayEnd: '23:59',
  afterCutoffBy: '12:00',
  workDays: [0, 1, 2, 3, 4, 5, 6],
};

describe('computeDeliveryPromise (Asia/Tashkent)', () => {
  it('promises +12 h before cut-off (design: 10:42 → 22:42)', () => {
    const start = fromTashkent(2026, 10, 26, 10, 42);
    const p = computeDeliveryPromise(start, tashkentExpress);
    expect(p.kind).toBe('SAME_DAY');
    expect(formatTashkentHm(p.deadline)).toBe('22:42');
    expect(toTashkentParts(p.deadline).day).toBe(26);
  });

  it('caps to same-day end when +12 h crosses midnight', () => {
    const p = computeDeliveryPromise(fromTashkent(2026, 10, 26, 17, 59), tashkentExpress);
    expect(formatTashkentHm(p.deadline)).toBe('23:59');
    expect(toTashkentParts(p.deadline).day).toBe(26);
  });

  it('after 18:00 promises next day 12:00', () => {
    const p = computeDeliveryPromise(fromTashkent(2026, 10, 26, 18, 0), tashkentExpress);
    expect(p.kind).toBe('NEXT_DAY');
    expect(formatTashkentHm(p.deadline)).toBe('12:00');
    expect(toTashkentParts(p.deadline).day).toBe(27);
  });

  it('handles UTC day boundary correctly (01:00 Tashkent = 20:00 UTC previous day)', () => {
    const start = fromTashkent(2026, 10, 27, 1, 0);
    expect(start.toISOString()).toBe('2026-10-26T20:00:00.000Z');
    const p = computeDeliveryPromise(start, tashkentExpress);
    expect(formatTashkentHm(p.deadline)).toBe('13:00');
    expect(toTashkentParts(p.deadline).day).toBe(27);
  });

  it('rolls non-working days to the next working day (Sunday off)', () => {
    const monSat: DeliveryRule = { ...tashkentExpress, workDays: [1, 2, 3, 4, 5, 6] };
    // 2026-10-24 is Saturday; after cut-off → Monday 26th 12:00.
    const sat = computeDeliveryPromise(fromTashkent(2026, 10, 24, 19, 0), monSat);
    expect(toTashkentParts(sat.deadline)).toMatchObject({ day: 26, hour: 12, weekday: 1 });
    // Sunday morning → Monday 12:00.
    const sun = computeDeliveryPromise(fromTashkent(2026, 10, 25, 9, 0), monSat);
    expect(toTashkentParts(sun.deadline)).toMatchObject({ day: 26, hour: 12 });
  });

  it('regions: plain +24 h', () => {
    const p = computeDeliveryPromise(fromTashkent(2026, 10, 26, 20, 15), {
      promiseHours: 24,
      workDays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(p.kind).toBe('WITHIN_HOURS');
    expect(toTashkentParts(p.deadline)).toMatchObject({ day: 27, hour: 20, minute: 15 });
  });

  it('throws on empty work days', () => {
    expect(() =>
      computeDeliveryPromise(fromTashkent(2026, 10, 26, 19), { ...tashkentExpress, workDays: [] }),
    ).toThrow(RangeError);
  });
});

describe('SLA state', () => {
  const deadline = fromTashkent(2026, 10, 26, 22, 42);
  it('classifies OK / AT_RISK / LATE', () => {
    expect(slaState(deadline, fromTashkent(2026, 10, 26, 16, 0))).toBe('OK');
    expect(slaState(deadline, fromTashkent(2026, 10, 26, 22, 0))).toBe('AT_RISK');
    expect(slaState(deadline, fromTashkent(2026, 10, 26, 22, 43))).toBe('LATE');
  });
});

describe('zones', () => {
  const base = { name: { uz: '', ru: '' }, etaLabel: { uz: '', ru: '' }, active: true, sort: 0 };
  const zones: DeliveryZone[] = [
    {
      ...base,
      key: 'tashkent-city',
      carrier: 'YANDEX',
      regions: ['tashkent_city'],
      priceSoum: 30000,
      freeFromSoum: 500000,
      rule: tashkentExpress,
    },
    {
      ...base,
      key: 'tashkent-city-bts',
      carrier: 'BTS',
      regions: ['tashkent_city'],
      priceSoum: 45000,
      freeFromSoum: 500000,
      rule: { promiseHours: 24, workDays: [0, 1, 2, 3, 4, 5, 6] },
      sort: 1,
    },
    {
      ...base,
      key: 'samarkand-center',
      carrier: 'BTS',
      regions: ['samarkand'],
      districts: ['samarkand_city'],
      priceSoum: 45000,
      freeFromSoum: 700000,
      rule: { promiseHours: 24, workDays: [0, 1, 2, 3, 4, 5, 6] },
    },
    {
      ...base,
      key: 'fallback',
      carrier: 'BTS',
      regions: [],
      priceSoum: 55000,
      freeFromSoum: null,
      rule: { promiseHours: 48, workDays: [0, 1, 2, 3, 4, 5, 6] },
    },
    {
      ...base,
      key: 'disabled',
      carrier: 'BTS',
      regions: ['tashkent_city'],
      priceSoum: 1,
      freeFromSoum: null,
      rule: { promiseHours: 1, workDays: [1] },
      active: false,
    },
  ];
  it('picks by region and district, falling back', () => {
    expect(pickZone(zones, 'tashkent_city').map((z) => z.key)).toEqual([
      'tashkent-city',
      'tashkent-city-bts',
    ]);
    expect(pickZone(zones, 'samarkand', 'samarkand_city').map((z) => z.key)).toEqual([
      'samarkand-center',
    ]);
    expect(pickZone(zones, 'samarkand', 'urgut').map((z) => z.key)).toEqual(['fallback']);
    expect(pickZone(zones, 'samarkand').map((z) => z.key)).toEqual(['fallback']);
  });
  it('applies free-from thresholds', () => {
    expect(shippingPriceSoum(zones[0]!, 499_999)).toBe(30000);
    expect(shippingPriceSoum(zones[0]!, 500_000)).toBe(0);
    expect(shippingPriceSoum(zones[3]!, 9_000_000)).toBe(55000);
  });
});
