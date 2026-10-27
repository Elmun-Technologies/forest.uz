import { Inject, Injectable } from '@nestjs/common';
import { type AdminStage, totpRequired, type StaffRole } from '@forest/contracts';
import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RedisService } from '../../redis/redis.module';
import { CSRF_COOKIE, isCsrfToken, newCsrfToken } from './csrf';

/**
 * Admin sessions (docs/05, docs/14): `fr_admin` = opaque id → Redis `adm:<id>`. Absolute expiry
 * (never sliding); host-only cookie on the admin origin (the browser reaches the API through the
 * admin app's `/api` rewrite), SameSite=Strict. A staff member's session ids are indexed in
 * `adm:staff:<staffId>` so deactivation or a TOTP reset can end them all.
 */
export const ADMIN_COOKIE = 'fr_admin';

export const ADMIN_SESSION_TTL_SEC: Record<AdminStage, number> = {
  /** docs/14: 12 h sessions. */
  full: 12 * 3600,
  /** Password accepted, waiting for the TOTP code. */
  totp: 5 * 60,
  /** Forced enrolment (Owner/Manager without TOTP). */
  setup: 30 * 60,
};

export interface AdminSessionData {
  staffId: string;
  /** TOTP code verified in this session (or at its creation). */
  totpVerified: boolean;
  csrf: string;
  createdAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
}

/** Where a session stands, recomputed from the live Staff row on every request. */
export function sessionStage(
  staff: { role: StaffRole; totpEnabled: boolean },
  totpVerified: boolean,
): AdminStage {
  if (staff.totpEnabled && !totpVerified) return 'totp';
  if (totpRequired(staff.role) && !staff.totpEnabled) return 'setup';
  return 'full';
}

const key = (id: string) => `adm:${id}`;
const staffKey = (staffId: string) => `adm:staff:${staffId}`;

@Injectable()
export class AdminSessionService {
  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(maxAgeSec: number, httpOnly: boolean): CookieOptions {
    return {
      httpOnly,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: maxAgeSec * 1000,
    };
  }

  /** New session (rotation: the previous one, if any, is destroyed). Sets both cookies. */
  async create(
    res: Response,
    input: {
      staffId: string;
      totpVerified: boolean;
      stage: AdminStage;
      previousId?: string | null;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<{ id: string; data: AdminSessionData }> {
    if (input.previousId) await this.drop(input.previousId, input.staffId);
    const ttl = ADMIN_SESSION_TTL_SEC[input.stage];
    const id = randomBytes(32).toString('base64url');
    const now = Date.now();
    const data: AdminSessionData = {
      staffId: input.staffId,
      totpVerified: input.totpVerified,
      csrf: newCsrfToken(),
      createdAt: now,
      expiresAt: now + ttl * 1000,
      ip: input.ip,
      userAgent: input.userAgent,
    };
    await this.redis
      .multi()
      .set(key(id), JSON.stringify(data), 'EX', ttl)
      .sadd(staffKey(input.staffId), id)
      .expire(staffKey(input.staffId), ADMIN_SESSION_TTL_SEC.full)
      .exec();
    res.cookie(ADMIN_COOKIE, id, this.cookieOptions(ttl, true));
    res.cookie(CSRF_COOKIE, data.csrf, this.cookieOptions(ttl, false));
    return { id, data };
  }

  async read(req: Request): Promise<{ id: string; data: AdminSessionData } | null> {
    const id = adminSessionId(req);
    if (!id) return null;
    const raw = await this.redis.get(key(id));
    if (!raw) return null;
    const data = JSON.parse(raw) as AdminSessionData;
    if (data.expiresAt <= Date.now()) return null;
    return { id, data };
  }

  async destroy(req: Request, res: Response, staffId: string | null): Promise<void> {
    const id = adminSessionId(req);
    if (id) await this.drop(id, staffId);
    this.clearCookies(res);
  }

  clearCookies(res: Response): void {
    const opts = { path: '/', sameSite: 'strict' as const };
    res.clearCookie(ADMIN_COOKIE, opts);
    res.clearCookie(CSRF_COOKIE, opts);
  }

  /** Ends every session of a staff member (deactivation, TOTP reset, lockout). */
  async destroyAll(staffId: string): Promise<void> {
    const ids = await this.redis.smembers(staffKey(staffId));
    await this.redis.del(...ids.map(key), staffKey(staffId));
  }

  /**
   * Pre-login CSRF token (login and invite forms): reuses a valid cookie, else issues one.
   * Bound to nothing; login replaces it with the session's token.
   */
  ensureCsrfCookie(req: Request, res: Response): string {
    const existing = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
    if (isCsrfToken(existing)) return existing;
    const token = newCsrfToken();
    res.cookie(CSRF_COOKIE, token, this.cookieOptions(ADMIN_SESSION_TTL_SEC.full, false));
    return token;
  }

  private async drop(id: string, staffId: string | null): Promise<void> {
    const m = this.redis.multi().del(key(id));
    if (staffId) m.srem(staffKey(staffId), id);
    await m.exec();
  }
}

export function adminSessionId(req: Request): string | null {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[ADMIN_COOKIE];
  return typeof v === 'string' && /^[\w-]{40,64}$/.test(v) ? v : null;
}
