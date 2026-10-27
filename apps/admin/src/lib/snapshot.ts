/**
 * A3 heatmap backdrop (CLAUDE.md §6): the storefront's anonymous SSR HTML, made inert for a
 * sandboxed `srcdoc` iframe — no scripts, no script preloads, and every `/_next/…` asset URL
 * pointed at the admin's same-origin proxy (`/sf/_next/…`) so fonts and images load.
 */
export const STOREFRONT_PROXY_PREFIX = '/sf';

/**
 * Locale-less storefront pathname accepted by the snapshot route: plain slug characters only —
 * no percent-escapes (a double-encoded `%2e%2e` would otherwise become `..` in `fetch`), no
 * backslashes, no dot segments, no `//`.
 */
export function isSnapshotPath(path: string): boolean {
  return (
    /^\/[\w\-/.]*$/.test(path) &&
    path.length <= 300 &&
    !path.split('/').some((seg) => seg === '.' || seg === '..') &&
    !path.includes('//')
  );
}

/**
 * The storefront page URL for a snapshot, or null. Built with `URL` and re-checked after
 * normalisation: same origin as the storefront and a `/uz` locale page — never the API or
 * anything outside the shop.
 */
export function snapshotUrl(base: string, path: string): URL | null {
  if (!isSnapshotPath(path)) return null;
  const origin = new URL(base).origin;
  const url = new URL(`/uz${path === '/' ? '' : path}`, origin);
  if (url.origin !== origin) return null;
  if (url.pathname !== '/uz' && !url.pathname.startsWith('/uz/')) return null;
  return url;
}

export function sanitizeSnapshot(html: string): string {
  const out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<link\b[^>]*\b(?:as=["']?script|rel=["']?modulepreload)[^>]*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/(["'(\s,=])\/_next\//g, `$1${STOREFRONT_PROXY_PREFIX}/_next/`);
  // Defense in depth on top of the sandbox: no script may run even if one slipped through.
  const csp = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">`;
  return /<head\b[^>]*>/i.test(out)
    ? out.replace(/<head\b[^>]*>/i, (m) => `${m}${csp}`)
    : `${csp}${out}`;
}

/**
 * Only storefront build assets and the image optimizer are proxied — never pages or the API.
 * `path` is the route's (once-decoded) catch-all; anything still percent-encoded, with a
 * backslash or a dot segment is refused, and the final URL is re-checked after normalisation.
 */
export function proxiedAssetUrl(base: string, path: string, search: string): URL | null {
  if (/[%\\]/.test(path)) return null;
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  if (!/^_next\/(?:static\/[\w\-/.[\]()]+|image)$/.test(path)) return null;
  const origin = new URL(base).origin;
  const url = new URL(`/${path}`, origin);
  if (url.origin !== origin) return null;
  if (!url.pathname.startsWith('/_next/static/') && url.pathname !== '/_next/image') return null;
  // Only the image optimizer takes a query (url, w, q).
  if (url.pathname === '/_next/image') url.search = search;
  return url;
}

/**
 * Recorded storefront asset URLs (`<origin>/_next/…`: CSS, fonts, optimized images) are pointed
 * at the admin's same-origin `/sf/_next/…` proxy: the admin CSP allows only first-party loads,
 * so the replayed DOM can't reach any other host.
 */
export function viaProxy(events: unknown[]): unknown[] {
  const origins = new Set<string>();
  for (const e of events as { type?: number; data?: { href?: unknown } }[]) {
    if (e.type !== 4 || typeof e.data?.href !== 'string') continue;
    try {
      origins.add(new URL(e.data.href).origin);
    } catch {
      // Not a URL: nothing to rewrite.
    }
  }
  if (origins.size === 0) return events;
  let json = JSON.stringify(events);
  for (const o of origins)
    json = json.split(`${o}/_next/`).join(`${STOREFRONT_PROXY_PREFIX}/_next/`);
  return JSON.parse(json) as unknown[];
}
