import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the API's on-demand revalidation call (CLAUDE.md §6). Same derivation and format as
 * `apps/api/src/seo/revalidate-signature.ts`: key = HMAC-SHA256(APP_ENCRYPTION_KEY bytes,
 * "forest:web-revalidate:v1"), header `t=<unix s>,v1=<hex HMAC(key, "<t>.<body>")>`, ±300 s.
 */
const LABEL = 'forest:web-revalidate:v1';
const MAX_SKEW_S = 300;

function key(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length === 32 ? createHmac('sha256', bytes).update(LABEL).digest() : null;
}

export function verifyRevalidateSignature(
  header: string | null,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const k = key();
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!k || !m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowS - t) > MAX_SKEW_S) return false;
  const expected = createHmac('sha256', k).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(m[2]!, 'hex'));
}

/** Tags the storefront uses: `product:<slug>`, `seo:<path>`, `settings`, `catalog`, `content`… */
export function isRevalidateTag(tag: unknown): tag is string {
  return typeof tag === 'string' && /^[a-z]+(:[^\s]{1,250})?$/.test(tag);
}
