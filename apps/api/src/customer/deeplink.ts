import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Signed Telegram `/start` payloads (docs/09). Telegram allows only [A-Za-z0-9_-] and at most
 * 64 chars, so the token is `base64url(compact JSON) + base64url(HMAC-SHA256)[0..SIG_LEN]`
 * with no separator: the signature has a fixed length. 96-bit truncated MAC is plenty for a
 * token that only attributes a lead source (it grants no access).
 */
export const DEEPLINK_MAX = 64;
const SIG_LEN = 16;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const SRC_RE = /^[a-z0-9_]{1,16}$/;

const wireSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('lead'), s: z.string().regex(SRC_RE) }),
]);

export type DeepLinkPayload = { kind: 'lead'; src: string };

function mac(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`tg-start:${body}`)
    .digest('base64url')
    .slice(0, SIG_LEN);
}

export function signDeepLink(payload: DeepLinkPayload, secret: string): string {
  if (!SRC_RE.test(payload.src)) throw new RangeError('deep link src must match [a-z0-9_]{1,16}');
  const body = Buffer.from(JSON.stringify({ k: payload.kind, s: payload.src })).toString(
    'base64url',
  );
  const token = body + mac(body, secret);
  if (token.length > DEEPLINK_MAX) throw new RangeError('deep link payload too long');
  return token;
}

/** Returns the payload for a genuine token, otherwise null (never throws on user input). */
export function verifyDeepLink(token: string, secret: string): DeepLinkPayload | null {
  if (token.length <= SIG_LEN || token.length > DEEPLINK_MAX || !TOKEN_RE.test(token)) return null;
  const body = token.slice(0, -SIG_LEN);
  const given = Buffer.from(token.slice(-SIG_LEN));
  const expected = Buffer.from(mac(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = wireSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString()));
    return parsed.success ? { kind: parsed.data.k, src: parsed.data.s } : null;
  } catch {
    return null;
  }
}

/** `https://t.me/<bot>?start=<token>`; null when no bot username is configured. */
export function telegramDeepLink(bot: string, token: string): string | null {
  const name = bot.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(name)) return null;
  return `https://t.me/${name}?start=${token}`;
}
