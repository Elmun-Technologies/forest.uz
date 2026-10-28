import { z } from 'zod';
import {
  AUDIENCE_CONSENTS,
  AUDIENCE_DESTINATIONS,
  AUDIENCE_DEVICES,
  AUDIENCE_EVENTS,
  AUDIENCE_LEAD_SOURCES,
  AUDIENCE_LIMITS as L,
  type AudienceAutoMessage,
  type AudienceRules,
} from '../audiences';
import { UZ_REGIONS } from '../regions';

/**
 * Admin A8 inputs (`/v1/admin/audiences/*`) and the stored rule tree (`Segment.rules`). Every
 * value the SQL compiler uses is bounded here; identifiers come only from these enums.
 */

const days = z.number().int().min(1).max(L.maxDays);
const optionalDays = days.nullable().optional();

/** Locale-less path: `/p/slug`; a leading `/uz` or `/ru` is dropped (the compiler adds both). */
const pathValue = z
  .string()
  .trim()
  .min(1)
  .max(L.path)
  .transform((v) => (v.startsWith('/') ? v : `/${v}`))
  .transform((v) => v.replace(/^\/(uz|ru)(?=\/|$)/, '') || '/')
  .refine((v) => !/[\s?#]/.test(v), 'path');

const pathMatch = z.object({ op: z.enum(['equals', 'prefix']), value: pathValue });

const REGION_CODES = UZ_REGIONS.map((r) => r.code) as [
  (typeof UZ_REGIONS)[number]['code'],
  ...(typeof UZ_REGIONS)[number]['code'][],
];

export const audienceConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event'),
    event: z.enum(AUDIENCE_EVENTS),
    did: z.boolean(),
    withinDays: days,
    path: pathMatch.nullable().optional(),
  }),
  z.object({
    type: z.literal('page_time'),
    path: pathMatch,
    minSeconds: z.number().int().min(1).max(L.maxSeconds),
    withinDays: days,
    did: z.boolean(),
  }),
  z.object({
    type: z.literal('orders'),
    metric: z.enum(['count', 'sum']),
    op: z.enum(['gte', 'lte']),
    value: z.number().int().min(0).max(10_000_000_000),
    withinDays: optionalDays,
  }),
  z.object({ type: z.literal('last_order'), op: z.enum(['within', 'older']), days }),
  z.object({
    type: z.literal('product'),
    productId: z.string().trim().min(1).max(64),
    bought: z.boolean(),
    withinDays: optionalDays,
    olderThanDays: optionalDays,
  }),
  z.object({
    type: z.literal('consent'),
    channel: z.enum(AUDIENCE_CONSENTS),
    granted: z.boolean(),
  }),
  z.object({
    type: z.literal('tag'),
    tag: z.string().trim().min(1).max(L.tag),
    has: z.boolean(),
  }),
  z.object({
    type: z.literal('region'),
    regions: z.array(z.enum(REGION_CODES)).min(1).max(REGION_CODES.length),
    include: z.boolean(),
  }),
  z.object({ type: z.literal('device'), device: z.enum(AUDIENCE_DEVICES) }),
  z.object({
    type: z.literal('lead'),
    has: z.boolean(),
    source: z.enum(AUDIENCE_LEAD_SOURCES).nullable().optional(),
  }),
]);

export const audienceRulesSchema = z.object({
  groups: z
    .array(
      z.object({
        conditions: z.array(audienceConditionSchema).min(1).max(L.conditionsPerGroup),
      }),
    )
    .min(1)
    .max(L.groups),
}) satisfies z.ZodType<AudienceRules, unknown>;

export const audienceAutoMessageSchema = z.object({
  enabled: z.boolean(),
  steps: z
    .array(
      z.object({
        channel: z.enum(['telegram', 'sms']),
        delayMinutes: z
          .number()
          .int()
          .min(0)
          .max(30 * 24 * 60),
        templateKey: z.string().trim().min(1).max(64),
      }),
    )
    .max(3),
}) satisfies z.ZodType<AudienceAutoMessage, unknown>;

const segmentFields = {
  name: z.string().trim().min(1).max(L.name),
  description: z
    .string()
    .trim()
    .max(L.description)
    .nullable()
    .transform((v) => v || null),
  rules: audienceRulesSchema,
  destinations: z
    .array(z.enum(AUDIENCE_DESTINATIONS))
    .max(AUDIENCE_DESTINATIONS.length)
    .transform((v) => [...new Set(v)]),
  autoMessage: audienceAutoMessageSchema.nullable(),
  active: z.boolean(),
};

export const segmentCreateSchema = z.object({
  ...segmentFields,
  description: segmentFields.description.default(null),
  destinations: segmentFields.destinations.default([]),
  autoMessage: segmentFields.autoMessage.default(null),
  active: segmentFields.active.default(true),
});
export type SegmentCreateInput = z.infer<typeof segmentCreateSchema>;

export const segmentUpdateSchema = z
  .object(segmentFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['name'] });
export type SegmentUpdateInput = z.infer<typeof segmentUpdateSchema>;

/** `GET /admin/audiences/preview?rules=<base64url JSON>` (a read, so a GET). */
export const audiencePreviewQuerySchema = z.object({
  rules: z
    .string()
    .max(16_384)
    .transform((v, ctx) => {
      try {
        return JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'rules' });
        return z.NEVER;
      }
    })
    .pipe(audienceRulesSchema),
});

export const segmentMembersQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
