import { z } from 'zod';
import { BOT_CONVERSATION_STATUSES, BOT_LIMITS, BOT_SCENARIOS } from '../bot';

/** A12 bot admin inputs (`/v1/admin/bot/*`): inbox (`bot.inbox`), scenarios/rules (`bot.edit`). */

export const botConversationListQuerySchema = z.object({
  status: z.enum(['all', ...BOT_CONVERSATION_STATUSES]).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type BotConversationListQuery = z.infer<typeof botConversationListQuerySchema>;

export const botReplySchema = z
  .object({
    text: z.string().trim().max(BOT_LIMITS.replyMax).default(''),
    /** Product card with a "Savatga qo'shish ↗" link (cart restore link with this line). */
    product: z
      .object({ variantId: z.string().min(1).max(64), qty: z.number().int().min(1).max(20) })
      .optional(),
  })
  .refine((v) => v.text.length > 0 || v.product !== undefined, { path: ['text'] });
export type BotReplyInput = z.infer<typeof botReplySchema>;

export const botConversationPatchSchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    assigneeId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined);
export type BotConversationPatchInput = z.infer<typeof botConversationPatchSchema>;

export const botScenarioToggleSchema = z.object({
  scenario: z.enum(BOT_SCENARIOS),
  enabled: z.boolean(),
});
export type BotScenarioToggleInput = z.infer<typeof botScenarioToggleSchema>;

export const botRulesUpdateSchema = z.object({
  complaintKeywords: z.array(z.string().trim().min(2).max(40)).max(100),
  version: z.string().nullable(),
});
export type BotRulesUpdateInput = z.infer<typeof botRulesUpdateSchema>;
