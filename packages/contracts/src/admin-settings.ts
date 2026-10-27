/**
 * Admin A16 Store / Delivery settings DTOs and the storefront promise preview. Zod-free (admin UI
 * imports it from `@forest/contracts/core`); input schemas live in `schemas/admin-settings.ts`.
 */
import type { z } from 'zod';
import { computeDeliveryPromise, type DeliveryZone, type PromiseKind } from './delivery';
import type { settingSchemas } from './schemas/settings';
import { formatTashkentHm, tashkentDayDiff } from './time';

export type StoreInfo = z.infer<(typeof settingSchemas)['store.info']>;
export type DeliveryRules = z.infer<(typeof settingSchemas)['delivery.rules']>;
export type ReturnsRules = z.infer<(typeof settingSchemas)['returns.rules']>;

export interface StoreSettingsDto {
  value: StoreInfo;
  /** Optimistic-concurrency token: send it back with the PUT. */
  version: string;
  /** All legal entity fields filled → legal pages lose their draft notice. */
  legalComplete: boolean;
}

export interface DeliverySettingsDto {
  zones: DeliveryZone[];
  rules: DeliveryRules;
  returns: ReturnsRules;
  version: string;
}

/** docs/14: data subject requests are answered within 30 days at most. */
export const DELETION_SLA_MAX_DAYS = 30;

export function legalComplete(legal: StoreInfo['legal']): boolean {
  return Object.values(legal).every((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * The storefront's own message templates (apps/web/messages, `<b>` tags dropped): cart/checkout
 * zone line and the product-page express line. A unit test keeps them identical to the web copy.
 */
export const STOREFRONT_PROMISE_TEMPLATES = {
  uz: {
    etaToday: '{zone}: bugun {time} gacha',
    etaTomorrow: '{zone}: ertaga {time} gacha',
    etaGeneric: '{zone}: {eta}',
    deliveryToday: 'Hozir buyurtma bersangiz, Toshkentda bugun {time} gacha yetkaziladi',
    deliveryTomorrow: 'Hozir buyurtma bersangiz, Toshkentda ertaga {time} gacha yetkaziladi',
    deliveryGeneric: 'Toshkentda {eta} yetkaziladi',
  },
  ru: {
    etaToday: '{zone}: сегодня до {time}',
    etaTomorrow: '{zone}: завтра до {time}',
    etaGeneric: '{zone}: {eta}',
    deliveryToday: 'Закажите сейчас — доставим по Ташкенту сегодня до {time}',
    deliveryTomorrow: 'Закажите сейчас — доставим по Ташкенту завтра до {time}',
    deliveryGeneric: 'Доставка по Ташкенту {eta}',
  },
} as const;

type Lang = keyof typeof STOREFRONT_PROMISE_TEMPLATES;
type TemplateKey = keyof (typeof STOREFRONT_PROMISE_TEMPLATES)['uz'];

function fill(lang: Lang, key: TemplateKey, vars: Record<string, string>): string {
  return STOREFRONT_PROMISE_TEMPLATES[lang][key].replace(
    /\{(\w+)\}/g,
    (_, k: string) => vars[k] ?? '',
  );
}

export type PreviewDay = 'today' | 'tomorrow' | 'generic';

export interface DeliveryPreviewZoneDto {
  zoneKey: string;
  carrier: DeliveryZone['carrier'];
  active: boolean;
  deadline: string;
  promiseKind: PromiseKind;
  day: PreviewDay;
  /** Cart / checkout line, as the storefront shows it. */
  text: { uz: string; ru: string };
}

export interface DeliveryPreviewDto {
  at: string;
  /** Product page / header line for the express (first active YANDEX) zone; null without one. */
  express: { zoneKey: string; text: { uz: string; ru: string } } | null;
  zones: DeliveryPreviewZoneDto[];
}

/** Same day split as the storefront (`optionEta` / `promiseLine`): today, tomorrow, else generic. */
function dayOf(at: Date, deadline: Date): PreviewDay {
  const diff = tashkentDayDiff(at, deadline);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : 'generic';
}

/**
 * What a customer ordering at `at` would read on the storefront for each zone (admin A16 preview).
 * Pure: the admin page runs it on unsaved edits, the API on saved settings.
 */
export function deliveryPromisePreview(
  zones: readonly DeliveryZone[],
  at: Date,
): DeliveryPreviewDto {
  const sorted = [...zones].sort((a, b) => a.sort - b.sort);
  const out: DeliveryPreviewZoneDto[] = [];
  for (const zone of sorted) {
    let deadline: Date;
    let kind: PromiseKind;
    try {
      ({ deadline, kind } = computeDeliveryPromise(at, zone.rule));
    } catch {
      continue; // invalid rule being edited (e.g. half-typed time): no line for it
    }
    const day = dayOf(at, deadline);
    const time = formatTashkentHm(deadline);
    const text = (lang: Lang) =>
      day === 'generic'
        ? fill(lang, 'etaGeneric', { zone: zone.name[lang], eta: zone.etaLabel[lang] })
        : fill(lang, day === 'today' ? 'etaToday' : 'etaTomorrow', {
            zone: zone.name[lang],
            time,
          });
    out.push({
      zoneKey: zone.key,
      carrier: zone.carrier,
      active: zone.active,
      deadline: deadline.toISOString(),
      promiseKind: kind,
      day,
      text: { uz: text('uz'), ru: text('ru') },
    });
  }
  const expressZone = sorted.find((z) => z.active && z.carrier === 'YANDEX');
  const expressLine = expressZone ? out.find((l) => l.zoneKey === expressZone.key) : undefined;
  const express =
    expressZone && expressLine
      ? {
          zoneKey: expressZone.key,
          text: {
            uz: expressText('uz', expressLine, expressZone),
            ru: expressText('ru', expressLine, expressZone),
          },
        }
      : null;
  return { at: at.toISOString(), express, zones: out };
}

function expressText(lang: Lang, line: DeliveryPreviewZoneDto, zone: DeliveryZone): string {
  if (line.day === 'generic') return fill(lang, 'deliveryGeneric', { eta: zone.etaLabel[lang] });
  return fill(lang, line.day === 'today' ? 'deliveryToday' : 'deliveryTomorrow', {
    time: formatTashkentHm(new Date(line.deadline)),
  });
}
