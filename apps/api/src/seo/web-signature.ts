import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';

/**
 * Signed server-to-server calls between the API and the storefront server (CLAUDE.md §6):
 * API → web `POST /api/revalidate`, web → API `POST /v1/seo/not-found`. One shared secret
 * (`WEB_REVALIDATE_SECRET`), one HMAC key per purpose. The web side mirrors this in
 * `apps/web/src/lib/web-signature.ts`; keep both in step.
 */
export const WEB_SIGNATURE_HEADER = 'x-forest-signature';
export const WEB_SIGNATURE_MAX_SKEW_S = 300;
export const WEB_CONTEXTS = {
  revalidate: 'forest:web-revalidate:v1',
  notFound: 'forest:seo-not-found:v1',
} as const;
const DEV_FALLBACK = 'forest:web-secret:dev-fallback:v1';

/**
 * `WEB_REVALIDATE_SECRET`, or — outside production only — a value derived from APP_ENCRYPTION_KEY
 * so local stacks and tests work without extra setup. null = not configured in production: the
 * signed calls fail closed (nothing is sent, nothing is accepted).
 */
export function webSharedSecret(
  env: Pick<Env, 'NODE_ENV' | 'WEB_REVALIDATE_SECRET' | 'APP_ENCRYPTION_KEY'>,
): Buffer | null {
  if (env.WEB_REVALIDATE_SECRET) return Buffer.from(env.WEB_REVALIDATE_SECRET, 'utf8');
  if (env.NODE_ENV === 'production') return null;
  return createHmac('sha256', Buffer.from(env.APP_ENCRYPTION_KEY, 'base64'))
    .update(DEV_FALLBACK)
    .digest();
}

export function contextKey(secret: Buffer, context: string): Buffer {
  return createHmac('sha256', secret).update(context).digest();
}

export function signWeb(key: Buffer, body: string, nowS = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', key).update(`${nowS}.${body}`).digest('hex');
  return `t=${nowS},v1=${mac}`;
}

export function verifyWeb(
  key: Buffer | null,
  header: string | null | undefined,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!key || !m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowS - t) > WEB_SIGNATURE_MAX_SKEW_S) return false;
  const expected = createHmac('sha256', key).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(m[2]!, 'hex'));
}

/** Tags the storefront uses (`apps/web`): `product:<slug>`, `seo:<path>`, plain names. */
export function isRevalidateTag(tag: string): boolean {
  return /^[a-z]+(:[^\s]{1,250})?$/.test(tag);
}
