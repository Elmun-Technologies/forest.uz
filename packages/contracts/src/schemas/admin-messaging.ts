import { z } from 'zod';
import {
  CUSTOM_TEMPLATE_KEY_RE,
  type MessageChannelKey,
  type MessageKind,
  type MessageScenario,
  TEMPLATE_BODY_MAX,
  TEMPLATE_BUTTON_TEXT_MAX,
  type TemplateButton,
} from '../message-templates';

/** A12 template editor and messaging settings (`/v1/admin/messaging/*`, `bot.edit`). */

const loc = (max: number) =>
  z.object({ uz: z.string().trim().max(max), ru: z.string().trim().max(max) });

const templateFields = {
  body: loc(TEMPLATE_BODY_MAX),
  buttons: z
    .array(z.object({ text: loc(TEMPLATE_BUTTON_TEXT_MAX), url: z.string().trim().max(500) }))
    .max(2),
  /** Minutes after the trigger (abandoned cart, review request); 0 = at once. */
  delayMin: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 60),
  smsFallback: z.boolean(),
  /** Staff attest the SMS text is approved in the Eskiz cabinet (docs/13 q.19). */
  smsApproved: z.boolean(),
  active: z.boolean(),
};

/**
 * Edits: with a changed body, `smsApproved` is stored only when `smsReapproved` is also true —
 * staff explicitly attest that the NEW wording is approved in Eskiz (the UI sets it when the box
 * is ticked after the text changed). Otherwise a changed text loses its approval.
 */
const updateFields = { ...templateFields, smsReapproved: z.boolean().default(false) };

export const messageTemplateUpdateSchema = z.object(updateFields);
export type MessageTemplateUpdateInput = z.infer<typeof messageTemplateUpdateSchema>;

export const messageTemplateCreateSchema = z.object({
  key: z.string().trim().regex(CUSTOM_TEMPLATE_KEY_RE),
  ...templateFields,
});
export type MessageTemplateCreateInput = z.infer<typeof messageTemplateCreateSchema>;

export const messageTemplateTestSchema = z.object({ locale: z.enum(['uz', 'ru']) });
export type MessageTemplateTestInput = z.infer<typeof messageTemplateTestSchema>;

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const messagingSettingsInputSchema = z.object({
  version: z.string().min(1),
  marketingPerDay: z.number().int().min(0).max(5),
  quietStart: hm,
  quietEnd: hm,
  operatorDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((v) => [...new Set(v)].sort()),
  operatorStart: hm,
  operatorEnd: hm,
  operatorIds: z
    .array(z.string().min(1).max(40))
    .max(50)
    .transform((v) => [...new Set(v)]),
  languages: z
    .array(z.enum(['uz', 'ru']))
    .min(1)
    .transform((v) => [...new Set(v)]),
  scenarios: z.object({
    abandonedCart: z.boolean(),
    reviewRequest: z.boolean(),
    waitlist: z.boolean(),
  }),
});
export type MessagingSettingsInput = z.infer<typeof messagingSettingsInputSchema>;

// ───────── DTOs ─────────

export interface MessageStatsDto {
  sent: number;
  skipped: number;
  failed: number;
}

export interface AdminMessageTemplateDto {
  key: string;
  label: string;
  kind: MessageKind;
  scenario: MessageScenario;
  vars: string[];
  channels: MessageChannelKey[];
  custom: boolean;
  body: { uz: string; ru: string };
  buttons: TemplateButton[];
  delayMin: number;
  smsFallback: boolean;
  smsApproved: boolean;
  active: boolean;
  updatedAt: string;
  /** Last 30 days of `Message` rows with this key. */
  stats: MessageStatsDto;
}

export interface MessagingScenarioDto {
  id: 'lead' | 'order' | 'abandonedCart' | 'advice' | 'reviewRequest' | 'waitlist';
  label: string;
  trigger: string;
  /** null = always on (service messages, bot flows run by the bot). */
  enabled: boolean | null;
  templates: string[];
  sent30d: number;
  /** Result over 30 days; null when the scenario has no measurable result here. */
  result30d: { kind: 'orders' | 'reviews'; count: number } | null;
}

export interface MessagingOverviewDto {
  scenarios: MessagingScenarioDto[];
  /** Marketing messages in 30 days: sent, skipped by cap / consent, unsubscribes. */
  marketing30d: { sent: number; skippedCap: number; skippedConsent: number; unsubscribed: number };
}

export interface MessagingSettingsDto {
  value: Omit<MessagingSettingsInput, 'version'> & {
    abandonedCartMinutes: number;
    reviewRequestDays: number;
  };
  version: string;
  bot: { status: string; username: string | null; tokenMasked: string | null };
  /** Staff who may answer the inbox (`bot.inbox`), for the operators picker. */
  operatorOptions: { id: string; name: string }[];
}

export interface MessageTestResultDto {
  channel: MessageChannelKey;
  to: string;
}

/** Storefront `/obuna/<token>` → `POST /v1/messaging/unsubscribe` (marketing opt-out link). */
export const unsubscribeInputSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export interface UnsubscribeResultDto {
  channel: 'sms' | 'telegram';
}
