import type { z } from 'zod';
import type { deliveryRuleSchema, deliveryZoneSchema } from './schemas/delivery';
import { atTashkentTime, parseHm, tashkentDayStart, toTashkentParts } from './time';

export const CARRIERS = ['YANDEX', 'BTS', 'PICKUP'] as const;
export type Carrier = (typeof CARRIERS)[number];

// Schemas live in ./schemas/delivery so this module (and the browser bundle) stays zod-free.
export type DeliveryRule = z.infer<typeof deliveryRuleSchema>;
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;

export type PromiseKind = 'SAME_DAY' | 'NEXT_DAY' | 'WITHIN_HOURS';

export interface DeliveryPromise {
  deadline: Date;
  kind: PromiseKind;
}

function nextWorkingDayStart(from: Date, workDays: readonly number[], offsetDays: number): Date {
  for (let i = offsetDays; i < offsetDays + 8; i++) {
    const day = tashkentDayStart(from, i);
    if (workDays.includes(toTashkentParts(day).weekday)) return day;
  }
  throw new RangeError('workDays must contain at least one weekday');
}

/** Computes the delivery deadline for a clock start `start` (Asia/Tashkent wall-clock rules). */
export function computeDeliveryPromise(start: Date, rule: DeliveryRule): DeliveryPromise {
  const workDays = rule.workDays ?? [0, 1, 2, 3, 4, 5, 6];
  const local = toTashkentParts(start);
  const minutesNow = local.hour * 60 + local.minute;
  const isWorkDay = workDays.includes(local.weekday);
  const pastCutoff = rule.cutoff !== undefined && minutesNow >= parseHm(rule.cutoff);

  if (rule.cutoff && rule.afterCutoffBy && (pastCutoff || !isWorkDay)) {
    const day = nextWorkingDayStart(start, workDays, 1);
    return { deadline: atTashkentTime(day, rule.afterCutoffBy), kind: 'NEXT_DAY' };
  }

  const byHours = new Date(start.getTime() + rule.promiseHours * 3_600_000);
  if (rule.cutoff && rule.sameDayEnd) {
    const sameDayEnd = atTashkentTime(tashkentDayStart(start), rule.sameDayEnd);
    if (byHours.getTime() > sameDayEnd.getTime()) return { deadline: sameDayEnd, kind: 'SAME_DAY' };
    return { deadline: byHours, kind: 'SAME_DAY' };
  }
  // Carriers without a cut-off (BTS) still don't deliver on their days off: roll forward whole days.
  let deadline = byHours;
  for (let i = 0; i < 7 && !workDays.includes(toTashkentParts(deadline).weekday); i++) {
    deadline = new Date(deadline.getTime() + 86_400_000);
  }
  return { deadline, kind: 'WITHIN_HOURS' };
}

/** Milliseconds left until deadline (negative = late). */
export function slaRemainingMs(deadline: Date, now: Date): number {
  return deadline.getTime() - now.getTime();
}

export type SlaState = 'OK' | 'AT_RISK' | 'LATE';

/** Admin dashboard: < 1 h left is critical (docs/02). */
export function slaState(deadline: Date, now: Date, riskWindowMs = 3_600_000): SlaState {
  const left = slaRemainingMs(deadline, now);
  if (left < 0) return 'LATE';
  if (left < riskWindowMs) return 'AT_RISK';
  return 'OK';
}

export function pickZone(
  zones: readonly DeliveryZone[],
  region: string,
  district?: string | null,
): DeliveryZone[] {
  const active = zones.filter((z) => z.active).sort((a, b) => a.sort - b.sort);
  const matches = active.filter(
    (z) =>
      z.regions.includes(region) &&
      (!z.districts ||
        z.districts.length === 0 ||
        (district != null && z.districts.includes(district))),
  );
  if (matches.length > 0) return matches;
  return active.filter((z) => z.regions.length === 0);
}

/** Shipping price for a zone given the merchandise subtotal (so'm). */
export function shippingPriceSoum(zone: DeliveryZone, subtotalSoum: number): number {
  if (zone.freeFromSoum !== null && subtotalSoum >= zone.freeFromSoum) return 0;
  return zone.priceSoum;
}
