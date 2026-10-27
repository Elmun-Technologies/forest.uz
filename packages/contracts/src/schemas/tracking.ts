import { z } from 'zod';
import {
  type AutoEventName,
  cleanErrorMessage,
  type CommerceEventName,
  TRACK_LIMITS,
  looksLikePii,
} from '../tracking';

/**
 * Wire format of `POST /v1/t` (docs/07 ingest). Each event is validated on its own so one bad
 * event never costs the batch; unknown props are stripped (the whitelist), strings are truncated
 * and any string that looks like a phone/email is replaced. `purchase`/`lead` are server-only and
 * therefore absent here.
 */

const REDACTED = '[redacted]';

/** Trimmed, truncated, PII-guarded text. */
const text = (max: number = TRACK_LIMITS.string) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .transform((s) => (looksLikePii(s) ? REDACTED : s));
/** Identifiers (product/variant ids, keys): short, no spaces. */
const key = z.string().regex(/^[\w.:-]{1,64}$/);
const count = z.number().int().min(0).max(1_000_000);
const soum = z.number().min(0).max(1e12);

const utmSchema = z
  .object({
    source: text(),
    medium: text(),
    campaign: text(),
    content: text(),
    term: text(),
  })
  .partial();
const clickIdsSchema = z
  .object({
    gclid: z.string().max(200),
    fbclid: z.string().max(200),
    ttclid: z.string().max(200),
    yclid: z.string().max(200),
  })
  .partial();

const clickProps = z.object({ track: text(40).optional(), tag: text(20).optional() });

/** Props per event name (the whitelist; must mirror `TrackPropsMap`). */
export const trackPropsSchemas = {
  page_view: z.object({
    landing: z.boolean().optional(),
    referrer: text(TRACK_LIMITS.path).optional(),
    utm: utmSchema.optional(),
    clickIds: clickIdsSchema.optional(),
    nav: z.enum(['load', 'spa']).optional(),
    locale: z.enum(['uz', 'ru']).optional(),
  }),
  scroll_depth: z.object({}),
  click: clickProps,
  rage_click: clickProps.extend({ count: z.number().int().min(1).max(100).optional() }),
  dead_click: clickProps,
  form_error: z.object({
    form: text(60).optional(),
    field: text(60),
    kind: z.enum(['required', 'pattern', 'type', 'range', 'length', 'invalid']).optional(),
  }),
  js_error: z.object({
    message: z
      .string()
      .transform(cleanErrorMessage)
      .transform((m) => (looksLikePii(m) ? REDACTED : m)),
    source: text(TRACK_LIMITS.path).optional(),
    line: count.optional(),
    col: count.optional(),
  }),
  web_vitals: z.object({
    metric: z.enum(['LCP', 'INP', 'CLS']),
    value: z.number().min(0).max(600_000),
    rating: z.enum(['good', 'needs-improvement', 'poor']),
  }),
  exit: z.object({
    durationMs: count.max(86_400_000).optional(),
    maxScroll: z.number().int().min(0).max(100).optional(),
  }),

  view_item_list: z.object({
    list: text(60),
    items: z.array(key).max(60).optional(),
    count: count.optional(),
  }),
  view_item: z.object({
    productId: key,
    slug: text(120).optional(),
    variantId: key.optional(),
    priceSoum: soum.optional(),
  }),
  select_variant: z.object({ productId: key.optional(), variantId: key }),
  calculator_used: z.object({
    productId: key.optional(),
    areaM2: z.number().min(0).max(10_000).optional(),
    coats: z.number().int().min(0).max(20).optional(),
    liters: z.number().min(0).max(100_000).optional(),
    preset: text(30).optional(),
  }),
  selector_used: z.object({ item: text(60) }),
  selector_result: z.object({
    item: text(60),
    inStock: z.boolean().optional(),
    priceSoum: soum.optional(),
    items: count.optional(),
  }),
  add_to_cart: z.object({
    variantId: key,
    qty: z.number().int().min(1).max(999),
    priceSoum: soum.optional(),
    list: text(60).optional(),
  }),
  remove_from_cart: z.object({ variantId: key, qty: z.number().int().min(0).max(999).optional() }),
  view_cart: z.object({ itemsCount: count, valueSoum: soum }),
  promo_applied: z.object({
    code: z.string().regex(/^[A-Z0-9_-]{3,32}$/),
    discountSoum: soum.optional(),
  }),
  promo_rejected: z.object({ reason: z.string().regex(/^[A-Z0-9_]{2,60}$/) }),
  begin_checkout: z.object({ itemsCount: count, valueSoum: soum }),
  add_shipping_info: z.object({ zoneKey: key, region: key.optional() }),
  add_payment_info: z.object({ method: z.enum(['PAYME', 'CLICK', 'COD']) }),
  search: z.object({ q: text(TRACK_LIMITS.q), results: count }),
  waitlist_join: z.object({ variantId: key }),
  telegram_click: z.object({ placement: text(60).optional() }),
  video_play: z.object({ placement: text(60).optional() }),
} satisfies Record<AutoEventName | CommerceEventName, z.ZodType>;

export type BrowserEventName = keyof typeof trackPropsSchemas;
export const BROWSER_EVENT_NAMES = Object.keys(trackPropsSchemas) as BrowserEventName[];

/** UUID (v7 from the tracker; any version accepted, lowercase or not). */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((s) => s.toLowerCase());

const eventBase = z.object({
  id: uuidSchema,
  /** Client epoch ms when it happened (corrected with the batch `now`). */
  t: z.number().int().min(0),
  path: z.string().max(2000),
  selector: z.string().max(TRACK_LIMITS.selector).optional(),
  /** Click x in ‰ of the document width. */
  x: z.number().int().min(0).max(1000).optional(),
  /** Click y in document px. */
  y: z.number().int().min(0).max(1_000_000).optional(),
  viewportW: z.number().int().min(0).max(20_000).optional(),
  scrollDepth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).optional(),
});

/** One raw event: name + base fields; `props` is validated against the name's schema. */
export const trackEventSchema = eventBase
  .extend({
    name: z.enum(BROWSER_EVENT_NAMES as [BrowserEventName, ...BrowserEventName[]]),
    props: z.unknown().optional(),
  })
  .transform((e, ctx) => {
    const parsed = trackPropsSchemas[e.name].safeParse(e.props ?? {});
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['props'], message: parsed.error.message });
      return z.NEVER;
    }
    return { ...e, props: parsed.data as Record<string, unknown> };
  });
export type TrackEventInput = z.input<typeof trackEventSchema>;
export type TrackEvent = z.output<typeof trackEventSchema>;

/** The envelope; `events` stay raw so each one is parsed (and dropped) individually. */
export const trackBatchSchema = z.object({
  /** Schema version. */
  v: z.literal(1),
  sid: uuidSchema,
  /** Client epoch ms at send time. */
  now: z.number().int().min(0),
  /** `navigator.webdriver` — automation → dropped as a bot. */
  wd: z.boolean().optional(),
  events: z.array(z.unknown()).min(1).max(TRACK_LIMITS.batchEvents),
});
export type TrackBatch = z.output<typeof trackBatchSchema>;
