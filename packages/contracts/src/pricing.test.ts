import { describe, expect, it } from 'vitest';
import { soumToTiyin as s } from './money';
import { allocate, priceCart, type PricingLine } from './pricing';
import { DomainError } from './errors';

const chalk: PricingLine = {
  variantId: 'cw-1l',
  qty: 1,
  unitPriceTiyin: s(329_000),
  compareAtTiyin: null,
  isBundle: false,
};
const spray: PricingLine = {
  variantId: 'fs-olv',
  qty: 2,
  unitPriceTiyin: s(249_000),
  compareAtTiyin: null,
  isBundle: false,
};
const brush: PricingLine = {
  variantId: 'br-40',
  qty: 1,
  unitPriceTiyin: s(119_000),
  compareAtTiyin: null,
  isBundle: false,
};
const kit: PricingLine = {
  variantId: 'kit-f',
  qty: 1,
  unitPriceTiyin: s(549_000),
  compareAtTiyin: s(607_000),
  isBundle: true,
};
const sofaKit: PricingLine = {
  variantId: 'kit-s',
  qty: 1,
  unitPriceTiyin: s(799_000),
  compareAtTiyin: s(896_000),
  isBundle: true,
};
const yandex = { priceTiyin: s(30_000), freeFromTiyin: s(500_000) };

describe('priceCart', () => {
  it('design cart: 946 000, free Tashkent delivery', () => {
    const r = priceCart({ lines: [chalk, spray, brush], shipping: yandex, maxDiscountPct: 15 });
    expect(r.subtotalTiyin).toBe(s(946_000));
    expect(r.shippingTiyin).toBe(0n);
    expect(r.totalTiyin).toBe(s(946_000));
    expect(r.freeShippingRemainingTiyin).toBeNull();
  });

  it('SALOM10 on 578 000 → −57 800; 520 200 still qualifies for free delivery from 500 000', () => {
    const r = priceCart({
      lines: [{ ...chalk }, { ...spray, qty: 1 }],
      promo: { code: 'SALOM10', type: 'PERCENT', value: 10, minCartTiyin: 0n },
      shipping: yandex,
      maxDiscountPct: 15,
    });
    expect(r.subtotalTiyin).toBe(s(578_000));
    expect(r.discountTiyin).toBe(s(57_800));
    expect(r.shippingTiyin).toBe(0n);
    expect(r.totalTiyin).toBe(s(520_200));
    expect(r.lines.reduce((a, l) => a + l.discountTiyin, 0n)).toBe(r.discountTiyin);
  });

  it('free-delivery threshold is checked after the code discount', () => {
    const r = priceCart({
      lines: [
        { ...chalk, qty: 1 },
        { ...brush, qty: 1 },
        { ...spray, qty: 1, unitPriceTiyin: s(72_000) },
      ],
      promo: { code: 'SALOM10', type: 'PERCENT', value: 10, minCartTiyin: 0n },
      shipping: yandex,
      maxDiscountPct: 15,
    });
    expect(r.subtotalTiyin).toBe(s(520_000));
    expect(r.shippingTiyin).toBe(s(30_000));
    expect(r.freeShippingRemainingTiyin).toBe(s(32_000));
    expect(r.totalTiyin).toBe(s(498_000));
  });

  it('shows remaining amount for free shipping', () => {
    const r = priceCart({ lines: [brush], shipping: yandex, maxDiscountPct: 15 });
    expect(r.freeShippingRemainingTiyin).toBe(s(381_000));
    expect(r.totalTiyin).toBe(s(149_000));
  });

  it('kit with −11 % beats a −10 % code (no stacking)', () => {
    const r = priceCart({
      lines: [sofaKit],
      promo: { code: 'SALOM10', type: 'PERCENT', value: 10, minCartTiyin: 0n },
      maxDiscountPct: 15,
    });
    expect(r.promo).toEqual({ status: 'rejected', code: 'SALOM10', reason: 'PROMO_NO_BENEFIT' });
    expect(r.discountTiyin).toBe(0n);
    expect(r.bundleSavingsTiyin).toBe(s(97_000));
  });

  it('code only adds the part exceeding kit savings', () => {
    const r = priceCart({
      lines: [kit, chalk],
      promo: { code: 'SALOM10', type: 'PERCENT', value: 10, minCartTiyin: 0n },
      maxDiscountPct: 15,
    });
    // base = 607 000 + 329 000 = 936 000; 10 % = 93 600; kit already saves 58 000 → extra 35 600.
    expect(r.discountTiyin).toBe(s(35_600));
    expect(r.promo).toMatchObject({ status: 'applied', capped: false });
  });

  it('margin guard caps total discount at 15 %', () => {
    const r = priceCart({
      lines: [chalk],
      promo: { code: 'TEST100', type: 'PERCENT', value: 100, minCartTiyin: 0n },
      maxDiscountPct: 15,
    });
    expect(r.discountTiyin).toBe(s(49_350));
    expect(r.promo).toMatchObject({ status: 'applied', capped: true });
  });

  it('margin guard leaves no room when kit savings already exceed the cap', () => {
    const r = priceCart({
      lines: [sofaKit],
      promo: { code: 'BIG', type: 'PERCENT', value: 50, minCartTiyin: 0n },
      maxDiscountPct: 10,
    });
    expect(r.promo).toMatchObject({ status: 'rejected', reason: 'PROMO_NO_BENEFIT' });
  });

  it('fixed amount, min cart and free shipping codes', () => {
    const fixed = priceCart({
      lines: [chalk, brush],
      promo: { code: 'KUZ50', type: 'FIXED', value: 50_000, minCartTiyin: s(400_000) },
      maxDiscountPct: 15,
    });
    expect(fixed.discountTiyin).toBe(s(50_000));
    const min = priceCart({
      lines: [brush],
      promo: { code: 'KUZ50', type: 'FIXED', value: 50_000, minCartTiyin: s(400_000) },
      maxDiscountPct: 15,
    });
    expect(min.promo).toEqual({ status: 'rejected', code: 'KUZ50', reason: 'PROMO_MIN_CART' });
    const ship = priceCart({
      lines: [brush],
      promo: { code: 'SHIP', type: 'FREE_SHIPPING', value: 0, minCartTiyin: 0n },
      shipping: yandex,
      maxDiscountPct: 15,
    });
    expect(ship.shippingTiyin).toBe(0n);
    expect(ship.totalTiyin).toBe(s(119_000));
  });

  it('gift product adds a zero-priced line', () => {
    const r = priceCart({
      lines: [chalk, spray],
      promo: {
        code: 'GIFT',
        type: 'GIFT',
        value: 0,
        minCartTiyin: 0n,
        gift: { variantId: 'br-40', unitPriceTiyin: s(119_000) },
      },
      maxDiscountPct: 15,
    });
    const gift = r.lines.find((l) => l.isGift);
    expect(gift?.discountTiyin).toBe(s(119_000));
    expect(r.totalTiyin).toBe(s(827_000));
    expect(r.subtotalTiyin).toBe(s(946_000));
  });

  it('rejects invalid quantity and empty cart is zero', () => {
    expect(() => priceCart({ lines: [{ ...chalk, qty: 0 }], maxDiscountPct: 15 })).toThrow(
      DomainError,
    );
    expect(() =>
      priceCart({ lines: [{ ...chalk, unitPriceTiyin: -1n }], maxDiscountPct: 15 }),
    ).toThrow(DomainError);
    expect(priceCart({ lines: [], maxDiscountPct: 15 }).totalTiyin).toBe(0n);
  });

  it('allocate sums exactly', () => {
    const parts = allocate(s(100), [s(1), s(1), s(1)]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(s(100));
    expect(allocate(0n, [1n])).toEqual([0n]);
  });
});
