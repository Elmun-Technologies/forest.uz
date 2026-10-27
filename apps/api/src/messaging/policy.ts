import {
  atTashkentTime,
  type MessageChannelKey,
  type MessageKind,
  parseHm,
  tashkentDayStart,
  toTashkentParts,
} from '@forest/contracts';

/**
 * The messaging policy (docs/02 + docs/09 "Rules"), pure so it is tested with a fixed clock.
 * `MessageDispatcher` is the only caller: every customer message passes here right before it is
 * sent (and again when a deferred message comes due).
 */

export interface PolicyRules {
  marketingPerDay: number;
  quietStart: string;
  quietEnd: string;
}

export interface SendContext {
  kind: MessageKind;
  channel: MessageChannelKey;
  now: Date;
  rules: PolicyRules;
  /** Latest consent per channel (marketing only needs it). */
  consent: { sms: boolean; telegram: boolean };
  /** Marketing messages already sent or in flight to this customer since Tashkent midnight. */
  marketingToday: number;
}

export type SendDecision =
  | { action: 'send' }
  | { action: 'defer'; until: Date }
  | { action: 'skip'; status: 'SKIPPED_NO_CONSENT' | 'SKIPPED_CAP'; reason: string };

/** Quiet window `start–end` (Tashkent); it may wrap midnight (21:00–09:00). Equal = none. */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === e) return false;
  const p = toTashkentParts(now);
  const m = p.hour * 60 + p.minute;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The moment the current quiet window ends (call only inside it). */
export function quietHoursEnd(now: Date, start: string, end: string): Date {
  const p = toTashkentParts(now);
  const m = p.hour * 60 + p.minute;
  // Evening part of a wrapping window → tomorrow's end; otherwise today's.
  const tomorrow = parseHm(start) > parseHm(end) && m >= parseHm(start);
  return atTashkentTime(tashkentDayStart(now, tomorrow ? 1 : 0), end);
}

export function decideSend(ctx: SendContext): SendDecision {
  if (ctx.kind === 'service') return { action: 'send' };
  if (ctx.kind === 'marketing') {
    const granted = ctx.channel === 'SMS' ? ctx.consent.sms : ctx.consent.telegram;
    if (!granted)
      return { action: 'skip', status: 'SKIPPED_NO_CONSENT', reason: `no ${ctx.channel} consent` };
  }
  // Quiet hours first: a deferred message is decided again (cap included) when it comes due.
  if (inQuietHours(ctx.now, ctx.rules.quietStart, ctx.rules.quietEnd))
    return {
      action: 'defer',
      until: quietHoursEnd(ctx.now, ctx.rules.quietStart, ctx.rules.quietEnd),
    };
  if (ctx.kind === 'marketing' && ctx.marketingToday >= ctx.rules.marketingPerDay)
    return {
      action: 'skip',
      status: 'SKIPPED_CAP',
      reason: `daily marketing cap ${ctx.rules.marketingPerDay} reached`,
    };
  return { action: 'send' };
}
