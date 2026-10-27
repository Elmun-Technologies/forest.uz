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
    /** A12 (Phase 5): staff answering the bot inbox; rows saved before default to none. */
    operatorIds: z.array(z.string()).default([]),
    /** Bot languages; the customer's locale (else Telegram `language_code`) picks one. */
    languages: z.array(z.enum(['uz', 'ru'])).default(['uz', 'ru']),
    /** Marketing automation switches (A12 scenarios). */
    scenarios: z
      .object({ abandonedCart: z.boolean(), reviewRequest: z.boolean(), waitlist: z.boolean() })
      .default({ abandonedCart: true, reviewRequest: true, waitlist: true }),
  }),
  /** Telegram bot (5A, A12): flow switches owned by the bot and complaint keywords. */
  'bot.rules': z.object({
    scenarios: z.object({ lead: z.boolean(), orderStatus: z.boolean(), advice: z.boolean() }),
    complaintKeywords: z.array(z.string().min(2).max(40)).max(100),
  }),
  'seo.verification': z.object({
    google: z.string().nullable(),
    yandex: z.string().nullable(),
    bing: z.string().nullable(),
  }),
  /** robots.txt body edited in A9; null = the generated default. */
  'seo.robots': z.object({ custom: z.string().nullable() }),
  /** schema.org JSON-LD blocks rendered by the storefront (A9 toggles). */
  'seo.schema': z.object({
    product: z.boolean(),
    organization: z.boolean(),
    breadcrumb: z.boolean(),
    faq: z.boolean(),
    howTo: z.boolean(),
    video: z.boolean(),
  }),
  /** IndexNow pings (Yandex, Bing); `key` is generated on install and served at /<key>.txt. */
  'seo.indexnow': z.object({
    enabled: z.boolean(),
    key: z.string().regex(/^[a-zA-Z0-9-]{8,128}$/),
  }),
  'tracking.rules': z.object({
    /** Session replay kill switch (A3); rows saved before it existed read as on. */
    replayEnabled: z.boolean().default(true),
    replaySamplePct: z.number().min(0).max(100),
    replayCheckoutPct: z.number().min(0).max(100),
  }),
  'returns.rules': z.object({
    returnDays: z.number().int().positive(),
    defectReportHours: z.number().int().positive(),
    refundBusinessDays: z.string(),
  }),
  flags: z.object({ marketplace: z.boolean(), cod: z.boolean(), bnpl: z.boolean() }),
  /**
   * Home page media blocks (admin-managed). Images are referenced by storage key; a block whose
   * value is null (or whose file is missing) is hidden.
   */
  'home.media': z.object({
    hero: z
      .object({
        beforeKey: z.string().min(1),
        afterKey: z.string().min(1),
        alt: loc,
        /** "Shu natija uchun" card on the slider; null hides the card. */
        productSlug: z.string().nullable(),
      })
      .nullable(),
    howTo: z
      .object({
        videoUrl: z.url(),
        posterKey: z.string().nullable(),
        durationMinutes: z.number().int().positive().nullable(),
      })
      .nullable(),
    leadImage: z.object({ key: z.string().min(1), alt: loc }).nullable(),
  }),
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
  /** `telegramBot`: bot username for the Telegram Login Widget; null = login widget unavailable. */
  auth: { telegramBot: string | null };
  /** Session replay gate (`tracking.rules`): kill switch and sample rates in %. */
  replay: { enabled: boolean; samplePct: number; checkoutPct: number };
}
