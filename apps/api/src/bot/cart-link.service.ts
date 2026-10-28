import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Locale } from '@forest/contracts';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * Cart restore links (docs/09 "Every button opens the right site page (cart restored)", Phase 5
 * acceptance): `<APP_URL>/c/<payload>.<sig>` where payload = base64url JSON
 * `{c?: cartId, l?: [[variantId, qty]], p?: promo, m?: utm campaign, g?: locale, e: exp (unix s)}` and
 * sig = HMAC-SHA256 (key derived from SESSION_SECRET) truncated to 32 base64url chars.
 * The link grants no account access: the storefront copies the lines into the browser's cart.
 */
export interface CartLinkPayload {
  cartId?: string;
  lines?: { variantId: string; qty: number }[];
  promo?: string;
  campaign?: string;
  /** Storefront language to open (else the browser's). */
  locale?: Locale;
  /** Unix seconds. */
  exp: number;
}

export const CART_LINK_TTL_SEC = 7 * 24 * 3600;
const SIG_LEN = 32;
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const wireSchema = z.object({
  c: ID.optional(),
  l: z
    .array(z.tuple([ID, z.number().int().min(1).max(99)]))
    .max(30)
    .optional(),
  p: z
    .string()
    .regex(/^[A-Z0-9_-]{3,32}$/)
    .optional(),
  m: z
    .string()
    .regex(/^[a-z0-9_]{1,32}$/)
    .optional(),
  g: z.enum(['uz', 'ru']).optional(),
  e: z.number().int().positive(),
});

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('forest:cart-link:v1').digest();
}

function mac(body: string, secret: string): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url').slice(0, SIG_LEN);
}

export function signCartLink(payload: CartLinkPayload, secret: string): string {
  const wire = {
    ...(payload.cartId ? { c: payload.cartId } : {}),
    ...(payload.lines?.length
      ? { l: payload.lines.map((l) => [l.variantId, l.qty] as [string, number]) }
      : {}),
    ...(payload.promo ? { p: payload.promo } : {}),
    ...(payload.campaign ? { m: payload.campaign } : {}),
    ...(payload.locale ? { g: payload.locale } : {}),
    e: payload.exp,
  };
  const parsed = wireSchema.parse(wire);
  const body = Buffer.from(JSON.stringify(parsed)).toString('base64url');
  return `${body}.${mac(body, secret)}`;
}

/** The payload of a genuine, unexpired token; null otherwise (never throws on user input). */
export function verifyCartLink(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): CartLinkPayload | null {
  if (token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, sig] = token.split('.') as [string, string];
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const w = wireSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString()));
    if (!w.success || w.data.e < nowSec) return null;
    return {
      cartId: w.data.c,
      lines: w.data.l?.map(([variantId, qty]) => ({ variantId, qty })),
      promo: w.data.p,
      campaign: w.data.m,
      locale: w.data.g,
      exp: w.data.e,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class CartLinkService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * `${APP_URL}/c/<token>` restoring a cart (abandoned-cart Telegram/SMS `{link}`; implements
   * messaging's `CartLinks`).
   */
  restoreUrl(
    input: { cartId: string; promo?: string; campaign?: string; locale?: Locale },
    now = new Date(),
  ): string {
    return this.url({ ...input, exp: Math.floor(now.getTime() / 1000) + CART_LINK_TTL_SEC });
  }

  /** Link adding these lines to the browser's cart (operator product card "Savatga ↗"). */
  addLinesUrl(
    lines: { variantId: string; qty: number }[],
    campaign = 'advice',
    now = new Date(),
  ): string {
    return this.url({ lines, campaign, exp: Math.floor(now.getTime() / 1000) + CART_LINK_TTL_SEC });
  }

  verify(token: string, now = new Date()): CartLinkPayload | null {
    return verifyCartLink(token, this.env.SESSION_SECRET, Math.floor(now.getTime() / 1000));
  }

  private url(payload: CartLinkPayload): string {
    const token = signCartLink(payload, this.env.SESSION_SECRET);
    return `${this.env.APP_URL.replace(/\/+$/, '')}/c/${token}`;
  }
}
