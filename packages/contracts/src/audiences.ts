/**
 * Audiences (A8) and ad-platform signals: rule tree types, destinations, DTOs (CLAUDE.md §6
 * "Audiences"). Zod-free (exported from `/core`) so the admin rule builder uses the same
 * vocabulary; the wire schemas are in `schemas/admin-audiences.ts`, the SQL compiler in the API.
 */
import type { RegionCode } from './regions';
import { TRACK_EVENT_NAMES, type TrackEventName } from './tracking';

// ───────────────────────── Rule tree ─────────────────────────

/** Events a rule may test. Noisy auto events (click, scroll…) are not audience material. */
export const AUDIENCE_EVENTS = [
  'page_view',
  'view_item_list',
  'view_item',
  'select_variant',
  'calculator_used',
  'selector_used',
  'selector_result',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'promo_applied',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'search',
  'waitlist_join',
  'telegram_click',
  'video_play',
  'lead',
  'purchase',
] as const satisfies readonly TrackEventName[];
export type AudienceEvent = (typeof AUDIENCE_EVENTS)[number];

/** Every audience event is a tracker event name (compile-time + this runtime guard for tests). */
export const isAudienceEvent = (v: unknown): v is AudienceEvent =>
  typeof v === 'string' &&
  (AUDIENCE_EVENTS as readonly string[]).includes(v) &&
  (TRACK_EVENT_NAMES as readonly string[]).includes(v);

export const AUDIENCE_CONSENTS = ['sms', 'telegram', 'ads'] as const;
export type AudienceConsent = (typeof AUDIENCE_CONSENTS)[number];

export const AUDIENCE_DEVICES = ['mobile', 'desktop', 'tablet'] as const;
export type AudienceDevice = (typeof AUDIENCE_DEVICES)[number];

/** `Customer.leadSource` values (lead form sources + Telegram login). */
export const AUDIENCE_LEAD_SOURCES = [
  'popup',
  'selector',
  'footer',
  'home',
  'bot',
  'checkout',
  'telegram_login',
] as const;
export type AudienceLeadSource = (typeof AUDIENCE_LEAD_SOURCES)[number];

export interface AudiencePathMatch {
  op: 'equals' | 'prefix';
  /** Locale-less storefront path (`/p/divan-yangilash-toplami`, `/katalog`). */
  value: string;
}

export type AudienceCondition =
  | {
      type: 'event';
      event: AudienceEvent;
      did: boolean;
      withinDays: number;
      path?: AudiencePathMatch | null;
    }
  | {
      type: 'page_time';
      path: AudiencePathMatch;
      minSeconds: number;
      withinDays: number;
      /** false = viewed it less than that (incl. never). */
      did: boolean;
    }
  | {
      type: 'orders';
      metric: 'count' | 'sum';
      op: 'gte' | 'lte';
      /** Count, or so'm for `sum`. */
      value: number;
      withinDays?: number | null;
    }
  | { type: 'last_order'; op: 'within' | 'older'; days: number }
  | {
      type: 'product';
      productId: string;
      bought: boolean;
      /** Purchase created within N days (bought) / no purchase within N days (not bought). */
      withinDays?: number | null;
      /** bought only: the purchase is at least N days old (upsell timing). */
      olderThanDays?: number | null;
    }
  | { type: 'consent'; channel: AudienceConsent; granted: boolean }
  | { type: 'tag'; tag: string; has: boolean }
  | { type: 'region'; regions: RegionCode[]; include: boolean }
  | { type: 'device'; device: AudienceDevice }
  | { type: 'lead'; has: boolean; source?: AudienceLeadSource | null };

export type AudienceConditionType = AudienceCondition['type'];

export const AUDIENCE_CONDITION_TYPES = [
  'event',
  'page_time',
  'orders',
  'last_order',
  'product',
  'consent',
  'tag',
  'region',
  'device',
  'lead',
] as const satisfies readonly AudienceConditionType[];

export interface AudienceGroup {
  conditions: AudienceCondition[];
}

/** Groups are OR-ed; conditions inside a group are AND-ed. */
export interface AudienceRules {
  groups: AudienceGroup[];
}

export const AUDIENCE_LIMITS = {
  groups: 5,
  conditionsPerGroup: 12,
  maxDays: 730,
  maxSeconds: 3_600,
  /** One page_view's time on page is capped (an open tab is not attention). */
  pageViewCapSeconds: 1_800,
  name: 80,
  description: 200,
  tag: 40,
  path: 200,
} as const;

/** Preset segments (docs/07, seeded) in the design's list order; custom segments follow. */
export const AUDIENCE_PRESET_KEYS = [
  'abandoned_cart_7d',
  'sofa_kit_viewers',
  'leads_no_purchase',
  'fabric_spray_upsell',
  'vip',
  'inactive_60d',
] as const;

// ───────────────────────── Destinations ─────────────────────────

export const AUDIENCE_DESTINATIONS = [
  'meta',
  'google',
  'tiktok',
  'yandex',
  'telegram',
  'sms',
] as const;
export type AudienceDestination = (typeof AUDIENCE_DESTINATIONS)[number];

/** Destinations that receive hashed phones (the rest are Phase 5 automation channels). */
export const AD_DESTINATIONS = ['meta', 'google', 'tiktok', 'yandex'] as const;
export type AdDestination = (typeof AD_DESTINATIONS)[number];

export const isAdDestination = (d: string): d is AdDestination =>
  (AD_DESTINATIONS as readonly string[]).includes(d);

/** Integration (A10) whose credentials a destination uses. */
export const AD_DESTINATION_INTEGRATION: Record<AdDestination, string> = {
  meta: 'meta_capi',
  google: 'google_ads',
  tiktok: 'tiktok_pixel',
  yandex: 'yandex_audience',
};

/** Smallest list each platform accepts when the audience is created (else status `too_small`). */
export const AD_DESTINATION_MIN_CREATE: Record<AdDestination, number> = {
  meta: 1,
  google: 1,
  tiktok: 1_000,
  yandex: 100,
};

/**
 * Phone as each platform wants it before SHA-256 (CLAUDE.md §6, docs/runbooks/ads.md):
 * Meta and Yandex digits with country code, Google and TikTok E.164 with `+`.
 * `e164` must already be `+998XXXXXXXXX` (storage format).
 */
export function adPhone(e164: string, platform: AdDestination): string | null {
  const digits = e164.replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) return null;
  return platform === 'meta' || platform === 'yandex' ? digits : `+${digits}`;
}

export const SEGMENT_SYNC_STATUSES = [
  'pending',
  'ok',
  'error',
  'not_connected',
  'too_small',
  'off',
] as const;
export type SegmentSyncStatus = (typeof SEGMENT_SYNC_STATUSES)[number];

// ───────────────────────── Automatic message (stored; runs in Phase 5) ─────────────────────────

export interface AudienceAutoMessageStep {
  channel: 'telegram' | 'sms';
  /** Minutes after the customer joined the segment. */
  delayMinutes: number;
  templateKey: string;
}

export interface AudienceAutoMessage {
  enabled: boolean;
  steps: AudienceAutoMessageStep[];
}

// ───────────────────────── Ad signals ─────────────────────────

/** Events forwarded server-side (docs/07 "Ad signals"). */
export const AD_SIGNAL_EVENTS = ['lead', 'add_to_cart', 'begin_checkout', 'purchase'] as const;
export type AdSignalEventName = (typeof AD_SIGNAL_EVENTS)[number];

export const AD_SIGNAL_PLATFORMS = ['meta', 'google', 'tiktok'] as const;
export type AdSignalPlatform = (typeof AD_SIGNAL_PLATFORMS)[number];

export const AD_SIGNAL_INTEGRATION: Record<AdSignalPlatform, string> = {
  meta: 'meta_capi',
  google: 'google_ads',
  tiktok: 'tiktok_pixel',
};

/** Which events each platform takes (Google: conversion actions exist for purchase + lead). */
export const AD_SIGNAL_PLATFORM_EVENTS: Record<AdSignalPlatform, readonly AdSignalEventName[]> = {
  meta: AD_SIGNAL_EVENTS,
  google: ['purchase', 'lead'],
  tiktok: AD_SIGNAL_EVENTS,
};

export const AD_SIGNAL_RULES = {
  /** Events younger than this are not read yet (ingest batches land a few seconds late). */
  lagMs: 2 * 60_000,
  /** Platforms reject old events (Meta: 7 days); older ones are never forwarded. */
  maxAgeMs: 7 * 86_400_000,
  maxAttempts: 8,
  /** Backoff after the n-th failure (last value repeats). */
  backoffMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3_600_000, 6 * 3_600_000],
  batch: 100,
} as const;

export function adSignalBackoffMs(attempts: number): number {
  const steps = AD_SIGNAL_RULES.backoffMs;
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1]!;
}

// ───────────────────────── DTOs ─────────────────────────

export interface AudienceSizeDto {
  total: number;
  withPhone: number;
  withTelegram: number;
  /** Phone + ADS_MATCHING consent: what ad platforms receive. */
  adsReady: number;
}

export interface SegmentDestinationStateDto {
  destination: AudienceDestination;
  enabled: boolean;
  status: SegmentSyncStatus;
  members: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Integration connected (or fake mode) — ad destinations only. */
  connected: boolean;
}

export interface SegmentResultDto {
  periodDays: number;
  members: number;
  converted: number;
  /** % with one decimal, null when no members. */
  crPct: number | null;
  revenueSoum: number;
}

export interface AdminSegmentDto {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  rules: AudienceRules;
  destinations: AudienceDestination[];
  autoMessage: AudienceAutoMessage | null;
  active: boolean;
  size: number;
  refreshedAt: string | null;
  refreshError: string | null;
  lastAdded: number;
  lastRemoved: number;
  destinationStates: SegmentDestinationStateDto[];
  result: SegmentResultDto;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSegmentListDto {
  items: AdminSegmentDto[];
  /** Ad signal forwarding over the last 24 h per platform (A10 logs hold the details). */
  signals: {
    platform: AdSignalPlatform;
    connected: boolean;
    sent: number;
    failed: number;
    pending: number;
  }[];
  templates: { key: string; preview: string }[];
  products: { id: string; name: string; slug: string }[];
  fakeMode: boolean;
}

export interface AdminSegmentMemberDto {
  customerId: string;
  publicId: string;
  phoneMasked: string | null;
  hasTelegram: boolean;
  adsConsent: boolean;
  addedAt: string;
}

export interface AdminSegmentMembersDto {
  items: AdminSegmentMemberDto[];
  nextCursor: string | null;
}
