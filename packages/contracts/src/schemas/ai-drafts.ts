import { z } from 'zod';

/** AI draft requests (admin, CLAUDE.md §6). The server builds prompts from stored data only. */

export const aiProductDraftSchema = z.object({
  productId: z.string().min(1).max(64),
  /** Optional staff hint ("emphasise odourless"), ≤ 300 chars, never stored. */
  hint: z.string().trim().max(300).default(''),
});
export type AiProductDraftInput = z.infer<typeof aiProductDraftSchema>;

export const aiSeoDraftSchema = z.object({
  /** Locale-less storefront path (`/p/<slug>`, `/katalog/<slug>`, `/ilhom/<slug>`, `/`…). */
  path: z
    .string()
    .trim()
    .max(200)
    .regex(/^\/[a-z0-9/_-]*$/),
});
export type AiSeoDraftInput = z.infer<typeof aiSeoDraftSchema>;

export const aiReplyDraftSchema = z.object({
  conversationId: z.string().min(1).max(64),
  locale: z.enum(['uz', 'ru']).optional(),
});
export type AiReplyDraftInput = z.infer<typeof aiReplyDraftSchema>;

/** Owner setting for operator reply drafts (audited). */
export const aiSettingsSchema = z.object({ replyDrafts: z.boolean() });
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;
