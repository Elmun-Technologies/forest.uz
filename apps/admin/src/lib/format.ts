import {
  formatTashkentDate,
  formatTashkentHm,
  tashkentDayDiff,
  toTashkentParts,
} from '@forest/contracts/core';

/** Admin times are Tashkent wall-clock (docs/02), independent of the browser's time zone. */

/** Audit style: "Bugun 14:12" · "Kecha 19:05" · "24.10 16:30" · "24.10.2025 16:30". */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const hm = formatTashkentHm(d);
  const diff = tashkentDayDiff(d, now);
  if (diff === 0) return `Bugun ${hm}`;
  if (diff === 1) return `Kecha ${hm}`;
  const date = formatTashkentDate(d);
  const sameYear = toTashkentParts(d).year === toTashkentParts(now).year;
  return `${sameYear ? date.slice(0, 5) : date} ${hm}`;
}

/** Staff list "Oxirgi kirish": "hozir" · "10 daq oldin" · "bugun 09:02" · "kecha" · "3 kun oldin". */
export function formatLastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 2) return 'hozir';
  if (minutes < 60) return `${minutes} daq oldin`;
  const days = tashkentDayDiff(d, now);
  if (days === 0) return `bugun ${formatTashkentHm(d)}`;
  if (days === 1) return 'kecha';
  if (days < 30) return `${days} kun oldin`;
  return formatTashkentDate(d);
}

/** "27-oktabr, seshanba" for page headers. */
const MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

export function formatLongDate(now: Date = new Date()): string {
  const p = toTashkentParts(now);
  return `${p.day}-${MONTHS[p.month - 1]}, ${WEEKDAYS[p.weekday]}`;
}

/** Initials for avatars: "Madina Karimova" → "MK", "Elmurodov" → "E". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : (parts[0]?.[0] ?? '?'))
    .toUpperCase()
    .slice(0, 2);
}
