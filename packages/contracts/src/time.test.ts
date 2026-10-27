import { describe, expect, it } from 'vitest';
import { formatTashkentDate, fromTashkent, parseHm, tashkentDayDiff } from './time';

describe('time (Asia/Tashkent)', () => {
  it('formats dates and day diffs', () => {
    expect(formatTashkentDate(fromTashkent(2026, 10, 13, 0, 30))).toBe('13.10.2026');
    expect(
      tashkentDayDiff(fromTashkent(2026, 10, 26, 23, 0), fromTashkent(2026, 10, 27, 1, 0)),
    ).toBe(1);
    expect(
      tashkentDayDiff(fromTashkent(2026, 10, 26, 1, 0), fromTashkent(2026, 10, 26, 23, 0)),
    ).toBe(0);
  });
  it('rejects bad HH:MM', () => {
    expect(() => parseHm('24:00')).toThrow(RangeError);
    expect(parseHm('18:00')).toBe(1080);
  });
});
