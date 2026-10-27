import { createHash } from 'node:crypto';
import { type AdDestination, type AdSignalEventName, adPhone } from '@forest/contracts';
import type { HealthResult } from '../types';

/**
 * Ports of the ad platforms (docs/06 "Ads & signals", docs/runbooks/ads.md): audience lists fed
 * with hashed phones, and server-side conversion events. Real adapters live next to this file;
 * fakes in `fake.ts`. Nothing here ever sees a raw phone except `hashPhone`.
 */

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** SHA-256 of the phone normalised the way `platform` wants it (null for unusable numbers). */
export function hashPhone(e164: string, platform: AdDestination): string | null {
  const normalized = adPhone(e164, platform);
  return normalized ? sha256Hex(normalized) : null;
}

export interface AudienceCreated {
  id: string;
  /** The initial hashes are already in the audience (platforms that create from a file). */
  seeded: boolean;
}

/**
 * One platform audience list. `create` makes the audience and returns its id as soon as it
 * exists; the caller stores the id before any further call (`confirm`, `add`), so a failure later
 * never loses it and the next sync continues on the same audience instead of creating another.
 */
export interface AudienceListProvider {
  readonly destination: AdDestination;
  create(name: string, hashes: string[]): Promise<AudienceCreated>;
  /** Second creation step of platforms that need one (Yandex `confirm`); idempotent. */
  confirm?(audienceId: string, name: string): Promise<void>;
  add(audienceId: string, hashes: string[]): Promise<void>;
  remove(audienceId: string, hashes: string[]): Promise<void>;
}

export interface AdConversion {
  /** Event row id (= the browser pixel's event_id). */
  eventId: string;
  name: AdSignalEventName;
  at: Date;
  /** Page URL where it happened (absolute). */
  url: string | null;
  valueSoum: number | null;
  /** Purchase: the order number (Google `order_id`, Meta `order_id`). */
  orderNumber: string | null;
  /** E.164 phone; each adapter normalises + hashes it itself. */
  phone: string | null;
  /** Our customer id (hashed by the adapter as external id). */
  customerId: string | null;
  clickIds: { fbclid?: string; gclid?: string; ttclid?: string };
  /** Session start (Meta `fbc` creation time). */
  clickAt: Date | null;
}

export interface ConversionSendResult {
  /** Events the platform refused, by event id → reason; the rest counts as sent. */
  failed: Map<string, string>;
  /** Events not sendable to this platform (missing identifiers / config) → reason. */
  skipped: Map<string, string>;
}

export interface ConversionProvider {
  readonly platform: 'meta' | 'google' | 'tiktok';
  send(events: AdConversion[]): Promise<ConversionSendResult>;
}

export interface AdsHealthCheck {
  test(): Promise<HealthResult>;
}

export const emptyResult = (): ConversionSendResult => ({ failed: new Map(), skipped: new Map() });

/** Short platform error text for logs/status (never a payload with identifiers). */
export function platformError(status: number, body: string): string {
  return `HTTP ${status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`;
}

export class AdPlatformError extends Error {}
