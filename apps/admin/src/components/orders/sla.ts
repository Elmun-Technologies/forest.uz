import { formatTashkentHm, tashkentDayDiff } from '@forest/contracts/core';

/** "6 soat 18 daq qoldi" · "42 daq qoldi" · "Kechikmoqda · 15 daq" (design A6). */
export function slaText(dueIso: string, now: Date): string {
  const ms = new Date(dueIso).getTime() - now.getTime();
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const span = h > 0 ? `${h} soat ${m} daq` : `${m} daq`;
  return ms < 0 ? `Kechikmoqda · ${span}` : `${span} qoldi`;
}

/** "bugun 22:42 gacha" · "ertaga 12:00 gacha" · "28.10 12:00 gacha". */
export function slaDeadline(dueIso: string, now: Date): string {
  const due = new Date(dueIso);
  const days = tashkentDayDiff(now, due);
  const hm = formatTashkentHm(due);
  if (days === 0) return `bugun ${hm} gacha`;
  if (days === 1) return `ertaga ${hm} gacha`;
  const d = due.toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
  });
  return `${d} ${hm} gacha`;
}

/** Share of the promise window left (0…1) for the A7 SLA bar. */
export function slaLeftShare(startIso: string | null, dueIso: string, now: Date): number {
  const due = new Date(dueIso).getTime();
  const start = startIso ? new Date(startIso).getTime() : due - 12 * 3_600_000;
  const total = Math.max(1, due - start);
  return Math.min(1, Math.max(0, (due - now.getTime()) / total));
}
