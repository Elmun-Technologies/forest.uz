import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.module';

/**
 * Customer sessions and first-party cookies (docs/05).
 * - `fr_session`: opaque id → Redis `sess:<id>` {customerId}; 90 days sliding; rotated on login.
 * - `fr_cart`:    anonymous cart id (cookie only; the cart row lives in Postgres).
 * - `fr_aid`:     random visitor id (400 days), set on cart writes; its hash is the device
 *                 fingerprint for "one first-order code per device" (docs/02). Carries no identity.
 * Browsers reach the API through the storefront's `/api/*` rewrite, so cookies are first-party
 * on the shop domain and SSR can forward them.
 */
export const SESSION_COOKIE = 'fr_session';
export const CART_COOKIE = 'fr_cart';
export const VISITOR_COOKIE = 'fr_aid';
const SESSION_TTL_SEC = 90 * 24 * 3600;
/** Browsers cap cookie lifetime at 400 days. */
const VISITOR_TTL_SEC = 400 * 24 * 3600;

export interface SessionData {
  customerId: string;
  createdAt: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  cookieOptions(maxAgeSec = SESSION_TTL_SEC): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeSec * 1000,
    };
  }

  async create(res: Response, customerId: string, previousId?: string | null): Promise<string> {
    if (previousId) await this.redis.del(`sess:${previousId}`);
    const id = randomBytes(24).toString('base64url');
    const data: SessionData = { customerId, createdAt: Date.now() };
    await this.redis.set(`sess:${id}`, JSON.stringify(data), 'EX', SESSION_TTL_SEC);
    res.cookie(SESSION_COOKIE, id, this.cookieOptions());
    return id;
  }

  async read(req: Request): Promise<SessionData | null> {
    const id = sessionId(req);
    if (!id) return null;
    const raw = await this.redis.get(`sess:${id}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    const [revokedAt] = await Promise.all([
      this.redis.get(revokedKey(data.customerId)),
      // Sliding expiry.
      this.redis.expire(`sess:${id}`, SESSION_TTL_SEC),
    ]);
    if (revokedAt !== null && data.createdAt <= Number(revokedAt)) {
      await this.redis.del(`sess:${id}`);
      return null;
    }
    return data;
  }

  /**
   * Ends every existing session of a customer (account merged / erased). Sessions aren't indexed
   * by customer in Redis, so `read` drops sessions created before this marker; it lives as long
   * as the longest session could.
   */
  async revokeCustomer(customerId: string, now = Date.now()): Promise<void> {
    await this.redis.set(revokedKey(customerId), String(now), 'EX', SESSION_TTL_SEC);
  }

  async destroy(req: Request, res: Response): Promise<void> {
    const id = sessionId(req);
    if (id) await this.redis.del(`sess:${id}`);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  setCartCookie(res: Response, cartId: string): void {
    res.cookie(CART_COOKIE, cartId, this.cookieOptions());
  }

  /** The visitor id from `fr_aid`, issuing a new one (and its cookie) when missing or malformed. */
  ensureVisitorId(req: Request, res: Response): string {
    const existing = visitorId(req);
    if (existing) return existing;
    const id = randomBytes(18).toString('base64url');
    res.cookie(VISITOR_COOKIE, id, this.cookieOptions(VISITOR_TTL_SEC));
    return id;
  }
}

const revokedKey = (customerId: string) => `sess:revoked:${customerId}`;

function cookieValue(req: Request, name: string): string | null {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && /^[\w-]{10,64}$/.test(v) ? v : null;
}

export function sessionId(req: Request): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

export function cartIdFromCookie(req: Request): string | null {
  return cookieValue(req, CART_COOKIE);
}

export function visitorId(req: Request): string | null {
  return cookieValue(req, VISITOR_COOKIE);
}

@Global()
@Module({ providers: [SessionService], exports: [SessionService] })
export class SessionModule {}
