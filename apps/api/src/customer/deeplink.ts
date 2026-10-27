import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Signed Telegram `/start` payloads (docs/09). Telegram allows only [A-Za-z0-9_-] and at most
 * 64 chars, so the token is `base64url(compact JSON) + base64url(HMAC-SHA256)[0..SIG_LEN]`
 * with no separator: the signature has a fixed length. 96-bit truncated MAC is plenty for a
 * token that only attributes a lead source or names a start record / an order whose tracking
 * token the holder already has (it grants no account access).
 */
export const DEEPLINK_MAX = 64;
const SIG_LEN = 16;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const SRC_RE = /^[a-z0-9_]{1,16}$/;

const REF_RE = /^[A-Za-z0-9_-]{12}$/;
const ORDER_TOKEN_RE = /^[A-Za-z0-9]{6,40}$/;

const wireSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('lead'), s: z.string().regex(SRC_RE) }),
  // Reference to a server-side start record (source + visitor, bot `tg:ref:<id>`).
  z.object({ k: z.literal('r'), i: z.string().regex(REF_RE) }),
  // Order tracking token: the bot shows that order's status.
  z.object({ k: z.literal('o'), t: z.string().regex(ORDER_TOKEN_RE) }),
]);

export type DeepLinkPayload =
  { kind: 'lead'; src: string } | { kind: 'ref'; id: string } | { kind: 'order'; token: string };

type Wire = z.infer<typeof wireSchema>;

function toWire(p: DeepLinkPayload): Wire {
  if (p.kind === 'lead') {
    if (!SRC_RE.test(p.src)) throw new RangeError('deep link src must match [a-z0-9_]{1,16}');
    return { k: 'lead', s: p.src };
  }
  if (p.kind === 'ref') {
    if (!REF_RE.test(p.id)) throw new RangeError('deep link ref must be 12 url-safe chars');
    return { k: 'r', i: p.id };
  }
  if (!ORDER_TOKEN_RE.test(p.token)) throw new RangeError('deep link order token is invalid');
  return { k: 'o', t: p.token };
}

function fromWire(w: Wire): DeepLinkPayload {
  if (w.k === 'lead') return { kind: 'lead', src: w.s };
  if (w.k === 'r') return { kind: 'ref', id: w.i };
  return { kind: 'order', token: w.t };
}

function mac(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`tg-start:${body}`)
    .digest('base64url')
    .slice(0, SIG_LEN);
}

export function signDeepLink(payload: DeepLinkPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(toWire(payload))).toString('base64url');
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
    return parsed.success ? fromWire(parsed.data) : null;
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
