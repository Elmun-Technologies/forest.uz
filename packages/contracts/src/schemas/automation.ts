import { z } from 'zod';
import { API_KEY_POLICY, API_KEY_SCOPES, WEBHOOK_EVENTS } from '../automation';

/** Admin inputs for outbound webhooks and partner API keys (CLAUDE.md §6). */

const name = z.string().trim().max(80);

/** URL syntax only; https / public-host rules are enforced by the API (environment-dependent). */
const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'WEBHOOK_URL_INVALID');

const events = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1)
  .max(WEBHOOK_EVENTS.length)
  .transform((v) => [...new Set(v)]);

export const webhookCreateSchema = z.object({ name: name.default(''), url: webhookUrl, events });
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

export const webhookUpdateSchema = z
  .object({ name, url: webhookUrl, events, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;

export const webhookDeliveriesQuerySchema = z.object({
  status: z.enum(['PENDING', 'DELIVERED', 'FAILED']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type WebhookDeliveriesQuery = z.infer<typeof webhookDeliveriesQuerySchema>;

export const apiKeyCreateSchema = z.object({
  name: name.min(1),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .transform((v) => [...new Set(v)]),
  rateLimitPerMin: z
    .number()
    .int()
    .min(1)
    .max(API_KEY_POLICY.maxRatePerMin)
    .default(API_KEY_POLICY.defaultRatePerMin),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

/** Partner API list queries. */
export const partnerListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;

export const partnerStockQuerySchema = partnerListQuerySchema.extend({
  /** Comma-separated SKUs (≤ 100); absent = all, paginated. */
  sku: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) =>
      v
        ? [
            ...new Set(
              v
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean),
            ),
          ].slice(0, 100)
        : undefined,
    ),
});
export type PartnerStockQuery = z.infer<typeof partnerStockQuerySchema>;
