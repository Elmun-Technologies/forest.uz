/**
 * Cookie consent (docs/07, docs/14). Stored in the first-party cookie `fr_consent` so both the
 * server and the Phase 4 tracker can read it. This module only stores the choice — nothing is
 * tracked here.
 *
 *   readConsent()?.marketing  → load ad pixels only when true
 *   window.addEventListener(CONSENT_EVENT, …) → react to changes without a reload
 */
export const CONSENT_COOKIE = 'fr_consent';
export const CONSENT_EVENT = 'fr:consent';
const MAX_AGE = 60 * 60 * 24 * 180;

export interface Consent {
  v: 1;
  /** First-party analytics + session replay sampling. */
  analytics: boolean;
  /** Ad pixels (Meta, Google Ads, TikTok) and audience matching. */
  marketing: boolean;
  /** Decision time, ms epoch. */
  ts: number;
}

export function parseConsent(raw: string | undefined | null): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<Consent>;
    if (v.v !== 1 || typeof v.analytics !== 'boolean' || typeof v.marketing !== 'boolean')
      return null;
    return { v: 1, analytics: v.analytics, marketing: v.marketing, ts: Number(v.ts) || 0 };
  } catch {
    return null;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? (m[1] ?? null) : null;
}

export function readConsent(): Consent | null {
  return parseConsent(readCookie(CONSENT_COOKIE));
}

export function writeConsent(choice: { analytics: boolean; marketing: boolean }): Consent {
  const value: Consent = { v: 1, ...choice, ts: Date.now() };
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  return value;
}
