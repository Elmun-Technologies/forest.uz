import { z } from 'zod';
import {
  HEATMAP_DEVICES,
  HEATMAP_PERIODS,
  REPLAY_FILTERS,
  REPLAY_REASONS,
  REPLAY_SESSION_ID_RE,
} from '../heatmaps';

/** Admin A3 inputs (`/v1/admin/heatmaps/*`, `/v1/admin/replays/*`) and the replay upload query. */

const period = z.coerce
  .number()
  .int()
  .refine((v) => (HEATMAP_PERIODS as readonly number[]).includes(v))
  .default(30);

/** A locale-less storefront pathname (`/`, `/katalog`, `/p/divan-toplami`). */
export const heatmapPathSchema = z
  .string()
  .max(300)
  .regex(/^\/[^\s?#]*$/);

export const heatmapPagesQuerySchema = z.object({
  device: z.enum(HEATMAP_DEVICES).default('mobile'),
  days: period,
});
export type HeatmapPagesQuery = z.infer<typeof heatmapPagesQuerySchema>;

export const heatmapQuerySchema = z.object({
  path: heatmapPathSchema.default('/'),
  device: z.enum(HEATMAP_DEVICES).default('mobile'),
  days: period,
});
export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>;

export const heatmapRefreshSchema = z.object({
  /** Days to rebuild, ending today (Tashkent). */
  days: z.number().int().min(1).max(31).default(2),
});
export type HeatmapRefreshInput = z.infer<typeof heatmapRefreshSchema>;

export const replayListQuerySchema = z.object({
  filter: z.enum(REPLAY_FILTERS).optional(),
  device: z.enum(HEATMAP_DEVICES).optional(),
  /** Sessions that viewed this (locale-less) page. */
  path: heatmapPathSchema.optional(),
  days: period,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ReplayListQuery = z.infer<typeof replayListQuerySchema>;

export const replaySessionIdSchema = z.string().regex(REPLAY_SESSION_ID_RE);

export const replaySettingsInputSchema = z.object({
  value: z.object({
    replayEnabled: z.boolean(),
    replaySamplePct: z.number().int().min(0).max(100),
    replayCheckoutPct: z.number().int().min(0).max(100),
  }),
  version: z.string().min(1).max(64),
});
export type ReplaySettingsInput = z.infer<typeof replaySettingsInputSchema>;

/** `POST /v1/t/replay?sid=&reason=` (body = gzip). */
export const replayUploadQuerySchema = z.object({
  sid: z.string().regex(REPLAY_SESSION_ID_RE),
  reason: z.enum(REPLAY_REASONS).default('sample'),
});
export type ReplayUploadQuery = z.infer<typeof replayUploadQuerySchema>;
