/**
 * Money is stored and computed as integer tiyin (1 so'm = 100 tiyin) in `bigint`.
 * Public API responses expose whole so'm as `number` (UZS amounts stay far below 2^53).
 */
export type Tiyin = bigint;

export const TIYIN_PER_SOUM = 100n;

export function soumToTiyin(soum: number | bigint): Tiyin {
  if (typeof soum === 'bigint') return soum * TIYIN_PER_SOUM;
  if (!Number.isFinite(soum)) throw new RangeError('soum must be finite');
  // Click sends decimal so'm strings like "329000.00"; round to the nearest tiyin.
  return BigInt(Math.round(soum * 100));
}

export function tiyinToSoum(tiyin: Tiyin): number {
  const soum = Number(tiyin) / 100;
  if (!Number.isSafeInteger(Math.trunc(soum))) throw new RangeError('amount out of safe range');
  return soum;
}

/** Whole so'm for public API payloads (amounts are always whole so'm in this store). */
export function tiyinToSoumInt(tiyin: Tiyin): number {
  return Math.round(tiyinToSoum(tiyin));
}

/** Rounds half-up to a whole so'm (prices are displayed without decimals). */
export function roundToSoum(tiyin: Tiyin): Tiyin {
  const rem = tiyin % TIYIN_PER_SOUM;
  const base = tiyin - rem;
  return rem * 2n >= TIYIN_PER_SOUM ? base + TIYIN_PER_SOUM : base;
}

/** `pct` percent of `amount`, rounded half-up to a whole so'm. */
export function percentOf(amount: Tiyin, pct: number): Tiyin {
  if (pct < 0 || pct > 100) throw new RangeError('pct must be within 0..100');
  // Work in basis points to keep fractional percents exact.
  const bps = BigInt(Math.round(pct * 100));
  return roundToSoum((amount * bps) / 10_000n);
}

export function minTiyin(a: Tiyin, b: Tiyin): Tiyin {
  return a < b ? a : b;
}

export function maxTiyin(a: Tiyin, b: Tiyin): Tiyin {
  return a > b ? a : b;
}

export function sumTiyin(values: Iterable<Tiyin>): Tiyin {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

const NBSP = ' ';
const CURRENCY = { uz: "so'm", ru: 'сум' } as const;

/** Formats as `329 000` (no currency). Thousands separated by non-breaking spaces. */
export function formatAmount(tiyin: Tiyin): string {
  const negative = tiyin < 0n;
  const soum = roundToSoum(negative ? -tiyin : tiyin) / TIYIN_PER_SOUM;
  const grouped = soum.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return negative ? `−${grouped}` : grouped;
}

/** Formats as `329 000 so'm` / `329 000 сум`. */
export function formatSoum(tiyin: Tiyin, locale: 'uz' | 'ru' = 'uz'): string {
  return `${formatAmount(tiyin)}${NBSP}${CURRENCY[locale]}`;
}

/** Compact admin format: `562,1 mln`. */
export function formatCompactSoum(tiyin: Tiyin, locale: 'uz' | 'ru' = 'uz'): string {
  const soum = tiyinToSoum(tiyin);
  const units = locale === 'ru' ? { m: 'млн', b: 'млрд' } : { m: 'mln', b: 'mlrd' };
  const fmt = (n: number) => n.toFixed(1).replace('.', ',').replace(/,0$/, '');
  if (Math.abs(soum) >= 1e9) return `${fmt(soum / 1e9)}${NBSP}${units.b}`;
  if (Math.abs(soum) >= 1e6) return `${fmt(soum / 1e6)}${NBSP}${units.m}`;
  return formatAmount(tiyin);
}
