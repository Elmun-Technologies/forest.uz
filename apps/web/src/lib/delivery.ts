import type { PublicSettingsDto } from '@forest/contracts';
import { computeDeliveryPromise, formatTashkentHm, tashkentDayDiff } from '@forest/contracts/core';

type PublicZone = PublicSettingsDto['delivery']['zones'][number];

/** Tashkent express zone (Yandex) — drives the header bar and product countdown. */
export function expressZone(settings: PublicSettingsDto): PublicZone | undefined {
  return settings.delivery.zones.find((z) => z.carrier === 'YANDEX');
}

/** Nationwide zone: the BTS zone with the widest coverage (last by sort order). */
export function regionsZone(settings: PublicSettingsDto): PublicZone | undefined {
  return settings.delivery.zones.filter((z) => z.carrier === 'BTS').at(-1);
}

export type PromiseLine = { kind: 'today' | 'tomorrow'; time: string } | { kind: 'generic' };

/** "bugun 22:40 gacha" / "ertaga 12:00 gacha" for an order placed `now` (zone rule from settings). */
export function promiseLine(zone: PublicZone, now: Date): PromiseLine {
  const { deadline } = computeDeliveryPromise(now, zone.rule);
  const diff = tashkentDayDiff(now, deadline);
  if (diff === 0) return { kind: 'today', time: formatTashkentHm(deadline) };
  if (diff === 1) return { kind: 'tomorrow', time: formatTashkentHm(deadline) };
  return { kind: 'generic' };
}
