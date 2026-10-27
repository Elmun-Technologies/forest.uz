import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * API → web on-demand revalidation (CLAUDE.md §6). The web app derives the same key from the
 * shared APP_ENCRYPTION_KEY (`apps/web/src/lib/revalidate-auth.ts`); keep both in step.
 */
export const REVALIDATE_HEADER = 'x-forest-signature';
export const REVALIDATE_MAX_SKEW_S = 300;
const LABEL = 'forest:web-revalidate:v1';

export function revalidateKey(appEncryptionKeyB64: string): Buffer {
  return createHmac('sha256', Buffer.from(appEncryptionKeyB64, 'base64')).update(LABEL).digest();
}

export function signRevalidate(key: Buffer, body: string, nowS = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', key).update(`${nowS}.${body}`).digest('hex');
  return `t=${nowS},v1=${mac}`;
}

export function verifyRevalidate(
  key: Buffer,
  header: string | null | undefined,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowS - t) > REVALIDATE_MAX_SKEW_S) return false;
  const expected = createHmac('sha256', key).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(m[2]!, 'hex'));
}

/** Tags the storefront uses (`apps/web`): `product:<slug>`, `seo:<path>`, plain names. */
export function isRevalidateTag(tag: string): boolean {
  return /^[a-z]+(:[^\s]{1,250})?$/.test(tag);
}
