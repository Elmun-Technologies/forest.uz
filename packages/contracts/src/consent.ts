/**
 * Cookie consent value (`fr_consent`, docs/07, docs/14), shared by the storefront (writes it) and
 * the API (reads it, e.g. before storing a session replay). Zod-free.
 */
export const CONSENT_COOKIE = 'fr_consent';

export interface Consent {
  v: 1;
  /** First-party analytics. */
  analytics: boolean;
  /** Ad pixels (Meta, Google Ads, TikTok) and audience matching. */
  marketing: boolean;
  /** Session recording (rrweb). Absent in choices made before the toggle existed → false. */
  replay: boolean;
  /** Decision time, ms epoch. */
  ts: number;
}

/** Parses the raw (URI-encoded JSON) cookie value; null when missing or malformed. */
export function parseConsent(raw: string | undefined | null): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<Consent> | null;
    if (!v || v.v !== 1 || typeof v.analytics !== 'boolean' || typeof v.marketing !== 'boolean')
      return null;
    return {
      v: 1,
      analytics: v.analytics,
      marketing: v.marketing,
      replay: v.replay === true,
      ts: Number(v.ts) || 0,
    };
  } catch {
    return null;
  }
}
