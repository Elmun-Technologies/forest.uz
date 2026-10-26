import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Unguessable, URL-safe, no look-alike characters (0/O, 1/l/I) — used in links people may type. */
export function randomToken(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    const b = bytes[i] ?? 0;
    // Rejection sampling keeps the distribution uniform.
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
  }
  return out.length === length ? out : randomToken(length);
}

/** `/t/{token}` tracking links (docs/02: 10 chars, no PII). */
export const trackingToken = () => randomToken(10);
/** `/buyurtma/{publicId}` order-received links. */
export const orderPublicId = () => randomToken(16);

/** Storefront order page: order details and "pay again" while the reservation holds. */
export function orderPageUrl(appUrl: string, locale: string, publicId: string): string {
  return `${appUrl}/${locale}/buyurtma/${publicId}`;
}
