import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  formatAmount,
  formatCompactSoum,
  formatSoum,
  maxTiyin,
  minTiyin,
  percentOf,
  roundToSoum,
  soumToTiyin,
  sumTiyin,
  tiyinToSoum,
  tiyinToSoumInt,
} from './money';

const NB = '\u00A0';

describe('money', () => {
  it('converts so’m and tiyin exactly', () => {
    expect(soumToTiyin(329_000)).toBe(32_900_000n);
    expect(soumToTiyin(329_000n)).toBe(32_900_000n);
    expect(soumToTiyin(1.25)).toBe(125n);
    expect(tiyinToSoum(32_900_050n)).toBe(329_000.5);
    expect(tiyinToSoumInt(32_900_050n)).toBe(329_001);
    expect(() => soumToTiyin(Number.NaN)).toThrow(RangeError);
  });

  it('rounds half away from zero to whole so’m', () => {
    expect(roundToSoum(-160n)).toBe(-200n);
    expect(roundToSoum(-149n)).toBe(-100n);
    expect(roundToSoum(149n)).toBe(100n);
    expect(roundToSoum(150n)).toBe(200n);
    expect(roundToSoum(200n)).toBe(200n);
  });

  it('computes percentages in whole so’m', () => {
    expect(percentOf(soumToTiyin(578_000), 10)).toBe(soumToTiyin(57_800));
    expect(percentOf(soumToTiyin(100_001), 15)).toBe(soumToTiyin(15_000));
    expect(percentOf(soumToTiyin(1_000), 12.5)).toBe(soumToTiyin(125));
    expect(() => percentOf(1n, 101)).toThrow(DomainError);
    expect(() => percentOf(1n, Number.NaN)).toThrow(DomainError);
  });

  it('formats for display', () => {
    expect(formatAmount(soumToTiyin(946_000))).toBe(`946${NB}000`);
    expect(formatAmount(soumToTiyin(1_028_000))).toBe(`1${NB}028${NB}000`);
    expect(formatAmount(-soumToTiyin(57_800))).toBe(`−57${NB}800`);
    expect(formatSoum(soumToTiyin(329_000))).toBe(`329${NB}000${NB}so'm`);
    expect(formatSoum(soumToTiyin(329_000), 'ru')).toBe(`329${NB}000${NB}сум`);
    expect(formatCompactSoum(soumToTiyin(562_100_000))).toBe(`562,1${NB}mln`);
    expect(formatCompactSoum(soumToTiyin(2_000_000_000), 'ru')).toBe(`2${NB}млрд`);
    expect(formatCompactSoum(soumToTiyin(5_000))).toBe(`5${NB}000`);
    expect(formatCompactSoum(soumToTiyin(999_960_000))).toBe(`1${NB}mlrd`);
    expect(formatCompactSoum(soumToTiyin(950_000_000))).toBe(`950${NB}mln`);
  });

  it('aggregates', () => {
    expect(sumTiyin([1n, 2n, 3n])).toBe(6n);
    expect(minTiyin(1n, 2n)).toBe(1n);
    expect(maxTiyin(1n, 2n)).toBe(2n);
  });
});
