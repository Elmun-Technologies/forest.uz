import { parseHm } from '@forest/contracts';

/**
 * Bounds on the messaging settings (review 5B): quiet hours can't be switched off or squeezed,
 * and only owner-level staff (`settings.store`) may raise the marketing cap above 2 or move the
 * quiet window off the default night (docs/09: 21:00–09:00, max 1/day by default).
 */
export const MESSAGING_LIMITS = {
  minQuietMinutes: 8 * 60,
  /** Quiet window every non-owner setting must cover. */
  baseQuiet: { start: '21:00', end: '09:00' },
  maxPerDayStaff: 2,
  maxPerDayOwner: 5,
} as const;

const DAY = 24 * 60;

function windowMinutes(start: string, end: string): Set<number> {
  const s = parseHm(start);
  const e = parseHm(end);
  const out = new Set<number>();
  for (let m = s; m !== e; m = (m + 1) % DAY) out.add(m);
  return out;
}

export interface MessagingSettingsProblem {
  field: 'quietStart' | 'marketingPerDay';
  rule: 'quiet_too_short' | 'quiet_must_cover_night' | 'cap_too_high';
}

export function messagingSettingsProblems(
  value: { quietStart: string; quietEnd: string; marketingPerDay: number },
  ownerLevel: boolean,
): MessagingSettingsProblem[] {
  const out: MessagingSettingsProblem[] = [];
  const quiet = windowMinutes(value.quietStart, value.quietEnd);
  if (quiet.size < MESSAGING_LIMITS.minQuietMinutes)
    out.push({ field: 'quietStart', rule: 'quiet_too_short' });
  if (!ownerLevel) {
    const base = windowMinutes(MESSAGING_LIMITS.baseQuiet.start, MESSAGING_LIMITS.baseQuiet.end);
    if ([...base].some((m) => !quiet.has(m)))
      out.push({ field: 'quietStart', rule: 'quiet_must_cover_night' });
  }
  const max = ownerLevel ? MESSAGING_LIMITS.maxPerDayOwner : MESSAGING_LIMITS.maxPerDayStaff;
  if (value.marketingPerDay > max) out.push({ field: 'marketingPerDay', rule: 'cap_too_high' });
  return out;
}
