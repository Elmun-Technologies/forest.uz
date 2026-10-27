import { describe, expect, it } from 'vitest';
import {
  formatUzPhone,
  isE164Uz,
  maskUzPhone,
  normalizeUzPhone,
  parseUzPhone,
  phoneDigitsForHash,
} from './phone';

describe('phone', () => {
  it.each([
    ['90 123 45 67', '+998901234567'],
    ['+998 (90) 123-45-67', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['0901234567', '+998901234567'],
    ['33 123 45 67', '+998331234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it('reports precise errors', () => {
    expect(parseUzPhone('+998 90 12')).toEqual({ ok: false, error: 'PHONE_INCOMPLETE' });
    expect(parseUzPhone('+998 12 345 67 89')).toEqual({
      ok: false,
      error: 'PHONE_INVALID_OPERATOR',
    });
    expect(parseUzPhone('+998 90 123 45 678')).toEqual({ ok: false, error: 'PHONE_INVALID' });
    expect(normalizeUzPhone('abc')).toBeNull();
  });

  it('formats and masks', () => {
    expect(isE164Uz('+998901234567')).toBe(true);
    expect(isE164Uz('+998121234567')).toBe(false);
    expect(formatUzPhone('+998901234567')).toBe('+998 90 123 45 67');
    expect(formatUzPhone('garbage')).toBe('garbage');
    expect(maskUzPhone('+998901234567')).toBe('+998 90 *** ** 67');
    expect(maskUzPhone('x')).toBe('+998 ** *** ** **');
    expect(phoneDigitsForHash('+998901234567')).toBe('998901234567');
  });
});
