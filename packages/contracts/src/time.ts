/**
 * Asia/Tashkent is UTC+5 with no DST, so a fixed offset is exact and avoids Intl/ICU
 * differences between Node, browsers and test environments.
 */
export const TASHKENT_OFFSET_MINUTES = 5 * 60;
const OFFSET_MS = TASHKENT_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

export interface LocalParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export function toTashkentParts(date: Date): LocalParts {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Builds a UTC Date from a Tashkent wall-clock time. */
export function fromTashkent(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

/** Midnight (Tashkent) of the day containing `date`, shifted by `days`. */
export function tashkentDayStart(date: Date, days = 0): Date {
  const p = toTashkentParts(date);
  return new Date(fromTashkent(p.year, p.month, p.day).getTime() + days * DAY_MS);
}

/** Parses `HH:MM` into minutes since midnight. */
export function parseHm(hm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m) throw new RangeError(`invalid time "${hm}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function atTashkentTime(dayStart: Date, hm: string): Date {
  return new Date(dayStart.getTime() + parseHm(hm) * 60_000);
}

export function formatTashkentHm(date: Date): string {
  const p = toTashkentParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `13.10.2026` */
export function formatTashkentDate(date: Date): string {
  const p = toTashkentParts(date);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/** 0 = same Tashkent day, 1 = tomorrow, -1 = yesterday … */
export function tashkentDayDiff(from: Date, to: Date): number {
  return Math.round((tashkentDayStart(to).getTime() - tashkentDayStart(from).getTime()) / DAY_MS);
}
