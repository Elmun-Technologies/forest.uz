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

/** ISO instant → `YYYY-MM-DDTHH:mm` in Tashkent (value of `<input type="datetime-local">`). */
export function toDateTimeInput(iso: string | null): string {
  if (!iso) return '';
  const p = toTashkentParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DDTHH:mm` (Tashkent wall clock) → ISO with the +05:00 offset; '' → null. */
export function fromDateTimeInput(value: string): string | null {
  return value ? `${value}:00+05:00` : null;
}
