/**
 * AI drafts via the Claude integration (docs/06 "Automation & AI", CLAUDE.md §6). Drafts are only
 * suggestions: the admin fills editable fields and a human saves. Zod-free (admin UI).
 */

export const AI_DRAFT_KINDS = ['product_description', 'seo', 'reply'] as const;
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number];

export const AI_DRAFT_POLICY = {
  perStaffPerMin: 20,
  perDay: 300,
  /** Default model when the integration's `model` field is blank. */
  defaultModel: 'claude-opus-5-5',
  maxTokens: 4000,
} as const;

/** `GET /admin/ai/status`: drafts can run; operator reply drafts switched on by the Owner. */
export interface AiDraftStatusDto {
  available: boolean;
  /** Off by default: a reply draft sends the customer's latest message to Anthropic. */
  replyDrafts: boolean;
}

export interface AiDraftMetaDto {
  model: string;
  /** PROVIDERS_MODE=fake: deterministic placeholder text, not a real model answer. */
  fake: boolean;
}

export interface AiProductDescriptionDraftDto extends AiDraftMetaDto {
  shortDesc: { uz: string; ru: string };
  description: { uz: string; ru: string };
}

export interface AiSeoDraftDto extends AiDraftMetaDto {
  uz: { title: string; description: string };
  ru: { title: string; description: string };
}

export interface AiReplyDraftDto extends AiDraftMetaDto {
  text: string;
  locale: 'uz' | 'ru';
}
