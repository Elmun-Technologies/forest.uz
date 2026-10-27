export const MAX_PATH = 512;

/**
 * Canonical form of a storefront path for redirects and the 404 log: path only (query strings
 * and fragments can carry tokens/PII and explode cardinality), leading slash, no duplicate
 * slashes, capped length. Returns null for anything that is not a same-site path.
 */
export function normalizePath(input: string): string | null {
  let raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  raw = raw.split(/[?#]/)[0] ?? '';
  // Protocol-relative ("//evil.com") or control characters are never valid storefront paths.
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\s\\]/.test(raw) || hasControlChars(raw))
    return null;
  const path = raw.replace(/\/{2,}/g, '/');
  return path.length > MAX_PATH ? path.slice(0, MAX_PATH) : path;
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Path variants tried for a redirect lookup (trailing-slash tolerant). */
export function redirectCandidates(path: string): string[] {
  if (path === '/') return ['/'];
  return path.endsWith('/') ? [path, path.replace(/\/+$/, '')] : [path, `${path}/`];
}

/** Referrer reduced to origin + path (no query: search engines and apps put tokens there). */
export function normalizeReferrer(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname}`.slice(0, MAX_PATH);
  } catch {
    return null;
  }
}
