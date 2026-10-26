import { z } from 'zod';
import type { DeliveryRule } from '../delivery';
import { deliveryZoneSchema } from './delivery';

const hm = z.string().regex(/^\d{2}:\d{2}$/);
const loc = z.object({ uz: z.string(), ru: z.string() });

/** Setting keys and their value schemas (table `Setting`). Values are edited in admin A16. */
export const settingSchemas = {
  'store.info': z.object({
    name: z.string(),
    domain: z.string(),
    phone: z.string(),
    email: z.string(),
    hours: loc,
    telegramBot: z.string(),
    instagram: z.string().nullable(),
    languages: z.array(z.enum(['uz', 'ru'])),
    currency: z.literal('UZS'),
    dataLocation: z.string(),
    /** Legal entity data. `null` until the owner fills it — legal pages show a draft notice. */
    legal: z.object({
      entityName: z.string().nullable(),
      stir: z.string().nullable(),
      address: z.string().nullable(),
      bank: z.string().nullable(),
      mfo: z.string().nullable(),
      account: z.string().nullable(),
    }),
    offerVersion: z.string(),
    deletionSlaDays: z.number().int().positive(),
  }),
  'delivery.zones': z.array(deliveryZoneSchema),
  'delivery.rules': z.object({
    codMaxSoum: z.number().int().positive(),
    codAutoCancelHours: z.number().int().positive(),
    onlineReservationMinutes: z.number().int().positive(),
    paymentReminderMinutes: z.number().int().positive(),
  }),
  'promo.rules': z.object({ maxDiscountPct: z.number().min(0).max(100) }),
  'catalog.rules': z.object({ lowStockDefault: z.number().int().nonnegative() }),
  'messaging.rules': z.object({
    marketingPerDay: z.number().int().min(0),
    quietStart: hm,
    quietEnd: hm,
    operatorDays: z.array(z.number().int().min(0).max(6)),
    operatorStart: hm,
    operatorEnd: hm,
    abandonedCartMinutes: z.number().int().positive(),
    reviewRequestDays: z.number().int().positive(),
  }),
  'seo.verification': z.object({
    google: z.string().nullable(),
    yandex: z.string().nullable(),
    bing: z.string().nullable(),
  }),
  'tracking.rules': z.object({
    replaySamplePct: z.number().min(0).max(100),
    replayCheckoutPct: z.number().min(0).max(100),
  }),
  'returns.rules': z.object({
    returnDays: z.number().int().positive(),
    defectReportHours: z.number().int().positive(),
    refundBusinessDays: z.string(),
  }),
  flags: z.object({ marketplace: z.boolean(), cod: z.boolean(), bnpl: z.boolean() }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

/** Public settings for storefront (`GET /v1/settings/public`). No secrets, no PII. */
export interface PublicSettingsDto {
  store: {
    name: string;
    domain: string;
    phone: string;
    email: string;
    hours: { uz: string; ru: string };
    telegramBot: string;
    instagram: string | null;
    offerVersion: string;
    legalComplete: boolean;
  };
  delivery: {
    zones: {
      key: string;
      carrier: 'YANDEX' | 'BTS' | 'PICKUP';
      name: { uz: string; ru: string };
      etaLabel: { uz: string; ru: string };
      priceSoum: number;
      freeFromSoum: number | null;
      promiseHours: number;
      cutoff: string | null;
      /** Full promise rule for `computeDeliveryPromise` (storefront countdown line). */
      rule: DeliveryRule;
    }[];
    codMaxSoum: number;
  };
  seo: { google: string | null; yandex: string | null; bing: string | null };
  /** From `returns.rules` (hero trust row "14 kun qaytarish"). */
  returns: { returnDays: number };
  flags: { marketplace: boolean; cod: boolean; bnpl: boolean };
}
