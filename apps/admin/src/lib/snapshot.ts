/**
 * A3 heatmap backdrop (CLAUDE.md §6): the storefront's anonymous SSR HTML, made inert for a
 * sandboxed `srcdoc` iframe — no scripts, no script preloads, and every `/_next/…` asset URL
 * pointed at the admin's same-origin proxy (`/sf/_next/…`) so fonts and images load.
 */
export const STOREFRONT_PROXY_PREFIX = '/sf';

/** Locale-less storefront pathname accepted by the snapshot route. */
export function isSnapshotPath(path: string): boolean {
  return (
    /^\/[\w\-/.%]*$/.test(path) &&
    path.length <= 300 &&
    !path.includes('..') &&
    !path.includes('//')
  );
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

/** Only storefront build assets and the image optimizer are proxied — never pages or the API. */
export function isProxiedAsset(path: string): boolean {
  return /^_next\/(?:static\/[\w\-/.%[\]()]+|image)$/.test(path) && !path.includes('..');
}
