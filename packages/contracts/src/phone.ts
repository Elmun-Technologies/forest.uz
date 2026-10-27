/** Uzbekistan phone helpers. Storage format is E.164: `+998XXXXXXXXX`. */

/**
 * Operator / area codes accepted after +998: mobile operators (Beeline, Ucell, Uzmobile,
 * Mobiuz, Humans, Perfectum) and regional fixed-line codes.
 */
export const UZ_PHONE_CODES = new Set([
  '20',
  '33',
  '50',
  '55',
  '61',
  '62',
  '65',
  '66',
  '67',
  '69',
  '70',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '78',
  '79',
  '88',
  '90',
  '91',
  '93',
  '94',
  '95',
  '97',
  '98',
  '99',
]);

export type PhoneParseError = 'PHONE_INCOMPLETE' | 'PHONE_INVALID_OPERATOR' | 'PHONE_INVALID';

export type PhoneParseResult = { ok: true; e164: string } | { ok: false; error: PhoneParseError };

/** Accepts user input in any common form (`90 123 45 67`, `+998 (90) 123-45-67`, `998901234567`). */
export function parseUzPhone(input: string): PhoneParseResult {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 9) return { ok: false, error: 'PHONE_INCOMPLETE' };
  if (digits.length > 9) return { ok: false, error: 'PHONE_INVALID' };
  if (!UZ_PHONE_CODES.has(digits.slice(0, 2)))
    return { ok: false, error: 'PHONE_INVALID_OPERATOR' };
  return { ok: true, e164: `+998${digits}` };
}

export function normalizeUzPhone(input: string): string | null {
  const r = parseUzPhone(input);
  return r.ok ? r.e164 : null;
}

export function isE164Uz(value: string): boolean {
  return /^\+998\d{9}$/.test(value) && UZ_PHONE_CODES.has(value.slice(4, 6));
}

function parts(e164: string): [string, string, string, string] {
  const d = e164.slice(4);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)];
}

/** `+998 90 123 45 67` */
export function formatUzPhone(e164: string): string {
  if (!isE164Uz(e164)) return e164;
  const [op, a, b, c] = parts(e164);
  return `+998 ${op} ${a} ${b} ${c}`;
}

/** `+998 90 *** ** 67` — used in lists and anywhere full PII isn't needed. */
export function maskUzPhone(e164: string): string {
  if (!isE164Uz(e164)) return '+998 ** *** ** **';
  const [op, , , c] = parts(e164);
  return `+998 ${op} *** ** ${c}`;
}

/** Digits used for ad-platform hashing (Meta/Google expect country code, no `+`). */
export function phoneDigitsForHash(e164: string): string {
  return e164.replace(/\D/g, '');
}
