/**
 * Cookie consent (docs/07, docs/14). Stored in the first-party cookie `fr_consent` so both the
 * server and the tracker / replay recorder can read it. This module only stores the choice —
 * nothing is tracked here. The value shape and parser live in `@forest/contracts/core` (the API
 * checks `replay` before storing a session recording).
 *
 *   readConsent()?.marketing  → load ad pixels only when true
 *   readConsent()?.replay     → session recording allowed (still sampled)
 *   window.addEventListener(CONSENT_EVENT, …) → react to changes without a reload
 */
import { CONSENT_COOKIE, type Consent, parseConsent } from '@forest/contracts/core';

export { CONSENT_COOKIE, parseConsent };
export type { Consent };
export const CONSENT_EVENT = 'fr:consent';
const MAX_AGE = 60 * 60 * 24 * 180;

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? (m[1] ?? null) : null;
}

export function readConsent(): Consent | null {
  return parseConsent(readCookie(CONSENT_COOKIE));
}

export function writeConsent(choice: {
  analytics: boolean;
  marketing: boolean;
  /** Session recording; omitted = no (it is opt-in). */
  replay?: boolean;
}): Consent {
  // Recording needs analytics: an analytics opt-out also turns it off.
  const replay = choice.analytics && choice.replay === true;
  const value: Consent = { v: 1, ...choice, replay, ts: Date.now() };
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  return value;
}
