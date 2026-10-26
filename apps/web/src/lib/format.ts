import {
  formatAmount,
  formatSoum,
  formatTashkentDate,
  formatTashkentHm,
  type Locale,
  soumToTiyin,
  TASHKENT_DISTRICTS,
  tashkentDayDiff,
  UZ_REGIONS,
} from '@forest/contracts/core';

/** Region code (`tashkent_city`) → localized name; unknown codes are shown as stored. */
export function regionName(code: string, locale: Locale): string {
  return UZ_REGIONS.find((r) => r.code === code)?.[locale] ?? code;
}

/** Tashkent district code → localized name; free-text districts (other regions) pass through. */
export function districtName(code: string | null, locale: Locale): string | null {
  if (!code) return null;
  return TASHKENT_DISTRICTS.find((d) => d.code === code)?.[locale] ?? code;
}

/** "Toshkent shahri, Yunusobod" */
export function placeName(
  address: { region: string; district: string | null },
  locale: Locale,
): string {
  return [regionName(address.region, locale), districtName(address.district, locale)]
    .filter(Boolean)
    .join(', ');
}

export type When =
  { kind: 'today' | 'tomorrow'; time: string } | { kind: 'date'; date: string; time: string };

/** Tashkent-local "today/tomorrow/date + HH:MM" parts; callers localize with `common.today` etc. */
export function whenParts(iso: string, now: Date = new Date()): When {
  const d = new Date(iso);
  const time = formatTashkentHm(d);
  const diff = tashkentDayDiff(now, d);
  if (diff === 0) return { kind: 'today', time };
  if (diff === 1) return { kind: 'tomorrow', time };
  return { kind: 'date', date: formatTashkentDate(d), time };
}

/** Translates `whenParts` with the `common` namespace (`today`, `tomorrow`, `dateTime`). */
export function formatWhen(
  t: (key: 'today' | 'tomorrow' | 'dateTime', values: Record<string, string>) => string,
  iso: string,
  now?: Date,
): string {
  const w = whenParts(iso, now);
  return w.kind === 'date' ? t('dateTime', { date: w.date, time: w.time }) : t(w.kind, w);
}

/** RFC 4122 v4 id for Idempotency-Key; falls back when `crypto.randomUUID` is unavailable (http LAN). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `329 000 so'm` (NBSP separators) for message interpolation; in JSX prefer `<Price />`. */
export function soum(amount: number, locale: Locale, withCurrency = true): string {
  return withCurrency ? formatSoum(soumToTiyin(amount), locale) : formatAmount(soumToTiyin(amount));
}
