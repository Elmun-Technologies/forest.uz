import {
  formatAmount,
  formatCompactSoum,
  soumToTiyin,
  toTashkentParts,
} from '@forest/contracts/core';

/** Admin catalog formatting (so'm integers from the API, Tashkent calendar days). */
export const soum = (value: number): string => formatAmount(soumToTiyin(value));
export const compactSoum = (value: number): string => formatCompactSoum(soumToTiyin(value));

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant → `YYYY-MM-DD` in Tashkent (value of `<input type="date">`). */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const p = toTashkentParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM-DD` → ISO at the start (or last second) of that Tashkent day; '' → null. */
export function fromDateInput(value: string, endOfDay = false): string | null {
  if (!value) return null;
  return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}+05:00`;
}

/** `24.10.2026` */
export function shortDate(iso: string): string {
  const p = toTashkentParts(new Date(iso));
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}
