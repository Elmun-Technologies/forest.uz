import { z } from 'zod';
import {
  MOYSKLAD_DEFAULT_PRICE_TYPE,
  MOYSKLAD_DEFAULT_STATE_MAP,
  MOYSKLAD_FLOWS,
  MOYSKLAD_LOG_KINDS,
  MOYSKLAD_MIRRORED_STATUSES,
  MOYSKLAD_STOCK_POLL_MINUTES,
  MOYSKLAD_SYNC_SCOPES,
  type MoyskladFlow,
  type MoyskladMirroredStatus,
  type MoyskladSettings,
} from '../admin-moysklad';

/**
 * MoySklad entity ids look like UUIDs but don't carry the RFC 4122 variant bits
 * (`5427bc76-b95f-11eb-0a80-04bb000cd583`), so `z.uuid()` would reject real ones.
 */
export const MOYSKLAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const msId = z.string().trim().toLowerCase().regex(MOYSKLAD_ID);

const name = z.string().trim().max(100);
const stateName = z.string().trim().max(100);

const DEFAULT_FLOWS: Record<MoyskladFlow, boolean> = {
  products: true,
  prices: true,
  stock: true,
  orders: true,
  customers: true,
  statuses: true,
  // Needs a public HTTPS API URL and registration in MoySklad; polling covers the rest.
  webhooks: false,
};

const flowsShape = Object.fromEntries(MOYSKLAD_FLOWS.map((f) => [f, z.boolean()])) as Record<
  MoyskladFlow,
  z.ZodBoolean
>;
const stateShape = Object.fromEntries(
  MOYSKLAD_MIRRORED_STATUSES.map((s) => [s, stateName]),
) as Record<MoyskladMirroredStatus, typeof stateName>;

/**
 * Stored `Integration.config` of `moysklad`. Every field has a default, so an empty or older config
 * parses into complete settings.
 */
export const moyskladSettingsSchema = z.object({
  priceType: name.min(1).catch(MOYSKLAD_DEFAULT_PRICE_TYPE).default(MOYSKLAD_DEFAULT_PRICE_TYPE),
  storeId: msId.nullable().catch(null).default(null),
  organizationId: msId.nullable().catch(null).default(null),
  ikpuAttribute: name.min(1).catch('ikpu').default('ikpu'),
  deliveryAttribute: name.catch('dostavka').default('dostavka'),
  defaultCounterpartyId: msId.nullable().catch(null).default(null),
  reserve: z.boolean().catch(true).default(true),
  stockPollMinutes: z
    .number()
    .int()
    .min(MOYSKLAD_STOCK_POLL_MINUTES.min)
    .max(MOYSKLAD_STOCK_POLL_MINUTES.max)
    .catch(MOYSKLAD_STOCK_POLL_MINUTES.default)
    .default(MOYSKLAD_STOCK_POLL_MINUTES.default),
  stateMap: z
    .object(stateShape)
    .partial()
    .catch({})
    .default({})
    .transform((m) => ({ ...MOYSKLAD_DEFAULT_STATE_MAP, ...m })),
  flows: z
    .object(flowsShape)
    .partial()
    .catch({})
    .default({})
    .transform((f) => ({ ...DEFAULT_FLOWS, ...f })),
  pushSince: z.iso.datetime().nullable().catch(null).default(null),
}) satisfies z.ZodType<MoyskladSettings, unknown>;

/** Lenient read of whatever is stored (unknown keys dropped, bad values → defaults). */
export function parseMoyskladSettings(raw: unknown): MoyskladSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return moyskladSettingsSchema.parse(obj);
}

/** Admin PATCH: any subset; an empty id string clears it. `pushSince` is server-managed. */
export const moyskladSettingsPatchSchema = z
  .object({
    priceType: name.min(1),
    storeId: z.union([msId, z.literal('').transform(() => null), z.null()]),
    organizationId: z.union([msId, z.literal('').transform(() => null), z.null()]),
    ikpuAttribute: name.min(1),
    deliveryAttribute: name,
    defaultCounterpartyId: z.union([msId, z.literal('').transform(() => null), z.null()]),
    reserve: z.boolean(),
    stockPollMinutes: z
      .number()
      .int()
      .min(MOYSKLAD_STOCK_POLL_MINUTES.min)
      .max(MOYSKLAD_STOCK_POLL_MINUTES.max),
    stateMap: z.object(stateShape).partial().strict(),
    flows: z.object(flowsShape).partial().strict(),
  })
  .partial()
  .strict();
export type MoyskladSettingsPatch = z.infer<typeof moyskladSettingsPatchSchema>;

export const moyskladSyncSchema = z
  .object({ scope: z.enum(MOYSKLAD_SYNC_SCOPES).default('all') })
  .strict();
export type MoyskladSyncInput = z.infer<typeof moyskladSyncSchema>;

export const moyskladLogQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  kind: z.enum(MOYSKLAD_LOG_KINDS).optional(),
  ok: z.enum(['true', 'false']).optional(),
});
export type MoyskladLogQuery = z.infer<typeof moyskladLogQuerySchema>;
