/**
 * Admin A10 Integrations hub DTOs. Zod-free (admin UI imports from `@forest/contracts/core`).
 * Secrets never appear here: secret fields carry `maskSecret` output (last 4 characters) only.
 */

export const INTEGRATION_CATEGORIES = [
  'payment',
  'delivery',
  'erp',
  'crm',
  'feed',
  'fiscal',
  'messaging',
  'ads',
  'seo',
  'automation',
] as const;
export type IntegrationCategoryKey = (typeof INTEGRATION_CATEGORIES)[number];

export type IntegrationStatusKey = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'COMING_SOON';

export interface IntegrationCardDto {
  key: string;
  name: string;
  category: IntegrationCategoryKey;
  description: { uz: string; ru: string };
  mark: string | null;
  icon: string | null;
  status: IntegrationStatusKey;
  launchKit: boolean;
  /** Launch-kit readiness (CONNECTED, or the manual/setting rule for COD, IKPU, BTS). */
  ready: boolean;
  /** Why a launch-kit item without credentials is (not) ready. */
  readyNote:
    | { kind: 'manual' }
    | { kind: 'cod'; enabled: boolean }
    | { kind: 'ikpu'; missing: number }
    | null;
  availability: 'available' | 'coming_soon';
  implemented: boolean;
  /** Has credential fields the Owner can save. */
  connectable: boolean;
  /** Own admin page (MoySklad) — the card links there instead of opening the panel. */
  dedicatedPage: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
}

export interface IntegrationsHubDto {
  items: IntegrationCardDto[];
  connected: number;
  total: number;
  launchKit: { ready: number; total: number };
  /** PROVIDERS_MODE=fake: tests succeed without calling providers. */
  fakeMode: boolean;
}

export interface IntegrationFieldDto {
  key: string;
  label: { uz: string; ru: string };
  type: 'text' | 'secret' | 'select' | 'textarea';
  required: boolean;
  options: string[] | null;
  /** Text/select value as stored; secrets masked (`•••• •••• 3c0d`); null when empty. */
  value: string | null;
}

export interface IntegrationLogDto {
  id: string;
  at: string;
  direction: string;
  kind: string;
  ok: boolean;
  message: string;
  /** Redacted at write and again at read. */
  payload: unknown;
}

export interface IntegrationWebhookDto {
  /** Full URL to paste in the provider cabinet; null when it carries a secret (reveal first). */
  url: string | null;
  /** Additional paths (Click: /prepare and /complete). */
  urls: string[];
  secret: boolean;
  /** The URL is sent with every request automatically (Eskiz, Yandex): no cabinet setup needed. */
  automatic: boolean;
}

export interface IntegrationDetailDto extends IntegrationCardDto {
  fields: IntegrationFieldDto[];
  docsUrl: string | null;
  webhook: IntegrationWebhookDto | null;
  logs: IntegrationLogDto[];
}

export interface IntegrationTestResultDto {
  ok: boolean;
  message: string;
  status: IntegrationStatusKey;
  checkedAt: string;
}
