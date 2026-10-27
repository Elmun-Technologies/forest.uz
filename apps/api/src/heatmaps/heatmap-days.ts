import { tashkentDayStart, toTashkentParts } from '@forest/contracts';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of the Tashkent day containing `date`. */
export function tashkentDay(date: Date): string {
  const p = toTashkentParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** A Prisma `@db.Date` value for a `YYYY-MM-DD` day (UTC midnight, as Postgres DATE round-trips). */
export function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * The `count` Tashkent days ending with the day of `now` (oldest first), each with its UTC bounds
 * [start, end) for constraining `Event.ts` (partition pruning).
 */
export function lastDays(count: number, now: Date): { day: string; start: Date; end: Date }[] {
  const today = tashkentDayStart(now);
  const out: { day: string; start: Date; end: Date }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(today.getTime() - i * DAY_MS);
    out.push({ day: tashkentDay(start), start, end: new Date(start.getTime() + DAY_MS) });
  }
  return out;
}
