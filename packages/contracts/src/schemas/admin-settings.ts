import { z } from 'zod';
import { DELETION_SLA_MAX_DAYS } from '../admin-settings';
import { TASHKENT_DISTRICTS, UZ_REGIONS } from '../regions';
import { uzPhoneSchema } from './common';
import { deliveryZoneSchema } from './delivery';
import { settingSchemas } from './settings';

/**
 * Admin A16 Store / Delivery inputs. The stored shapes are `settingSchemas`; these add the stricter
 * rules an edit must pass (so a typo never reaches checkout).
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const loc = (max: number) => z.object({ uz: text(1, max), ru: text(1, max) });
/** Blank legal inputs are stored as null (= not filled yet; legal pages stay "draft"). */
const legalField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

export const storeInfoInputSchema = settingSchemas['store.info'].extend({
  name: text(1, 80),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/),
  phone: uzPhoneSchema,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  hours: loc(80),
  telegramBot: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ''))
    .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/)),
  instagram: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((v) => (v ? v.replace(/^@/, '') : null)),
  languages: z
    .array(z.enum(['uz', 'ru']))
    .min(1)
    .transform((v) => [...new Set(v)]),
  dataLocation: text(1, 80),
  legal: z.object({
    entityName: legalField(160),
    stir: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v : null))
      .pipe(
        z
          .string()
          .regex(/^\d{9}$/)
          .nullable(),
      ),
    address: legalField(240),
    bank: legalField(160),
    mfo: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v : null))
      .pipe(
        z
          .string()
          .regex(/^\d{5}$/)
          .nullable(),
      ),
    account: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v.replace(/\s/g, '') : null))
      .pipe(
        z
          .string()
          .regex(/^\d{20}$/)
          .nullable(),
      ),
  }),
  offerVersion: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,64}$/),
  deletionSlaDays: z.number().int().min(1).max(DELETION_SLA_MAX_DAYS),
});

export const storeSettingsInputSchema = z.object({
  value: storeInfoInputSchema,
  version: z.string().max(64),
});
export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>;

const REGION_CODES = new Set<string>(UZ_REGIONS.map((r) => r.code));
const DISTRICT_CODES = new Set<string>(TASHKENT_DISTRICTS.map((d) => d.code));
const MAX_SOUM = 100_000_000;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

const zoneInputSchema = deliveryZoneSchema.extend({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  name: loc(80),
  etaLabel: loc(80),
  priceSoum: z.number().int().min(0).max(MAX_SOUM),
  freeFromSoum: z.number().int().positive().max(MAX_SOUM).nullable(),
  sort: z.number().int().min(0).max(999),
});

export const deliverySettingsInputSchema = z
  .object({
    zones: z.array(zoneInputSchema).min(1).max(30),
    rules: settingSchemas['delivery.rules'].extend({
      codMaxSoum: z.number().int().positive().max(MAX_SOUM),
      codAutoCancelHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 14),
      onlineReservationMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60),
      paymentReminderMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60),
    }),
    returns: settingSchemas['returns.rules'].extend({
      returnDays: z.number().int().min(1).max(365),
      defectReportHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30),
      refundBusinessDays: text(1, 20),
    }),
    version: z.string().max(64),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.zones.forEach((zone, i) => {
      const at = (field: string) => ['zones', i, ...field.split('.')];
      if (seen.has(zone.key))
        ctx.addIssue({ code: 'custom', path: at('key'), message: 'duplicate zone key' });
      seen.add(zone.key);
      for (const r of zone.regions)
        if (!REGION_CODES.has(r))
          ctx.addIssue({ code: 'custom', path: at('regions'), message: `unknown region ${r}` });
      for (const d of zone.districts ?? [])
        if (!DISTRICT_CODES.has(d))
          ctx.addIssue({ code: 'custom', path: at('districts'), message: `unknown district ${d}` });
      for (const f of ['cutoff', 'sameDayEnd', 'afterCutoffBy'] as const) {
        const hm = zone.rule[f];
        if (hm !== undefined && !HM.test(hm))
          ctx.addIssue({ code: 'custom', path: at(`rule.${f}`), message: 'HH:MM' });
      }
      if ((zone.rule.sameDayEnd || zone.rule.afterCutoffBy) && !zone.rule.cutoff)
        ctx.addIssue({ code: 'custom', path: at('rule.cutoff'), message: 'cutoff required' });
      if (zone.rule.cutoff && !zone.rule.afterCutoffBy)
        ctx.addIssue({ code: 'custom', path: at('rule.afterCutoffBy'), message: 'required' });
      if (zone.liveQuote && zone.carrier !== 'YANDEX')
        ctx.addIssue({ code: 'custom', path: at('liveQuote'), message: 'YANDEX only' });
      if (zone.rule.promiseHours > 24 * 14)
        ctx.addIssue({ code: 'custom', path: at('rule.promiseHours'), message: 'too long' });
    });
    if (!v.zones.some((zone) => zone.active))
      ctx.addIssue({ code: 'custom', path: ['zones'], message: 'at least one active zone' });
  });
export type DeliverySettingsInput = z.infer<typeof deliverySettingsInputSchema>;

export const deliveryPreviewQuerySchema = z.object({
  at: z.iso.datetime({ offset: true }).optional(),
});
