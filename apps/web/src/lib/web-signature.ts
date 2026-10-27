import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed server-to-server calls with the API (CLAUDE.md §6): API → `POST /api/revalidate`,
 * storefront → API `POST /v1/seo/not-found`. Mirrors `apps/api/src/seo/web-signature.ts`: one
 * shared secret `WEB_REVALIDATE_SECRET`, key per purpose = HMAC-SHA256(secret, context), header
 * `t=<unix s>,v1=<hex HMAC(key, "<t>.<body>")>`, ±300 s. Outside production a missing secret is
 * derived from APP_ENCRYPTION_KEY (local stacks); in production it fails closed.
 */
export const WEB_SIGNATURE_HEADER = 'x-forest-signature';
export const WEB_CONTEXTS = {
  revalidate: 'forest:web-revalidate:v1',
  notFound: 'forest:seo-not-found:v1',
} as const;
type Context = (typeof WEB_CONTEXTS)[keyof typeof WEB_CONTEXTS];
const MAX_SKEW_S = 300;
const DEV_FALLBACK = 'forest:web-secret:dev-fallback:v1';

function sharedSecret(): Buffer | null {
  const secret = process.env.WEB_REVALIDATE_SECRET;
  if (secret && secret.length >= 32) return Buffer.from(secret, 'utf8');
  if (process.env.NODE_ENV === 'production') return null;
  const appKey = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'base64');
  return appKey.length === 32 ? createHmac('sha256', appKey).update(DEV_FALLBACK).digest() : null;
}

function key(context: Context): Buffer | null {
  const secret = sharedSecret();
  return secret ? createHmac('sha256', secret).update(context).digest() : null;
}

/** Header value for a signed call; null when no secret is configured (production). */
export function signWebRequest(
  context: Context,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): string | null {
  const k = key(context);
  return k
    ? `t=${nowS},v1=${createHmac('sha256', k).update(`${nowS}.${body}`).digest('hex')}`
    : null;
}

export function verifyWebSignature(
  context: Context,
  header: string | null,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const k = key(context);
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
