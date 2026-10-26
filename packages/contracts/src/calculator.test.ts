import { describe, expect, it } from 'vitest';
import { litersNeeded, recommendVariants } from './calculator';
import { soumToTiyin as s } from './money';

const chalk = [
  { variantId: '05', volumeMl: 500, priceTiyin: s(189_000), available: true },
  { variantId: '1', volumeMl: 1000, priceTiyin: s(329_000), available: true },
  { variantId: '25', volumeMl: 2500, priceTiyin: s(749_000), available: true },
];

describe('paint calculator', () => {
  it('design example: komod 3 m², 2 coats, 11 m²/L → 0,6 L → 1 L × 1', () => {
    expect(litersNeeded(3, 2, 11)).toBe(0.6);
    const r = recommendVariants(3, 2, 11, chalk);
    expect(r?.items).toEqual([{ variantId: '1', qty: 1 }]);
    expect(r?.totalTiyin).toBe(s(329_000));
  });

  it('small area → 0,5 L', () => {
    expect(recommendVariants(1.5, 2, 11, chalk)?.items).toEqual([{ variantId: '05', qty: 1 }]);
  });

  it('large area picks cheapest covering combination', () => {
    const r = recommendVariants(8, 2, 11, chalk); // 1.5 L → 1 L + 0,5 L = 518 000
    expect(r?.totalTiyin).toBe(s(518_000));
    expect(r?.coveredMl).toBe(1500);
  });

  it('skips unavailable variants and handles empty input', () => {
    const r = recommendVariants(
      3,
      2,
      11,
      chalk.map((v) => ({ ...v, available: v.variantId !== '1' })),
    );
    expect(r?.items).toEqual([{ variantId: '05', qty: 2 }]);
    expect(recommendVariants(0, 2, 11, chalk)).toBeNull();
    expect(recommendVariants(3, 2, 11, [])).toBeNull();
    expect(litersNeeded(3, 2, 0)).toBe(0);
  });
});
