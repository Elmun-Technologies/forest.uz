import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ApiKeyScope, API_KEY_POLICY, DomainError } from '@forest/contracts';
import type { Request, Response } from 'express';
import { RateLimiter } from '../customer/common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { apiKeyMatches, apiKeyPrefix, extractApiKey } from './api-key';

export const SCOPES_KEY = 'partnerScopes';
/** Scopes the partner route needs (all of them). */
export const RequireScopes = (...scopes: [ApiKeyScope, ...ApiKeyScope[]]) =>
  SetMetadata(SCOPES_KEY, scopes);

export interface PartnerRequest extends Request {
  apiKey?: { id: string; scopes: string[] };
}

/**
 * Partner API authentication (CLAUDE.md §6): key → prefix lookup → constant-time hash compare,
 * not revoked, scopes, then a per-key fixed-window rate limit with `X-RateLimit-*` headers.
 * Routes without `@RequireScopes` are refused (default deny).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('ApiKeyGuard');

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PartnerRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const needed = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!needed?.length) throw new DomainError('FORBIDDEN');
    const raw = extractApiKey(req.headers);
    const prefix = raw ? apiKeyPrefix(raw) : null;
    if (!raw || !prefix) throw new DomainError('API_KEY_INVALID');
    const key = await this.prisma.apiKey.findUnique({ where: { prefix } });
    if (!key || key.revokedAt || !apiKeyMatches(raw, key.keyHash))
      throw new DomainError('API_KEY_INVALID');
    if (!needed.every((s) => key.scopes.includes(s))) throw new DomainError('API_KEY_SCOPE');

    const r = await this.limiter.hit('partner', key.id, key.rateLimitPerMin, 60);
    res.setHeader('X-RateLimit-Limit', String(key.rateLimitPerMin));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, key.rateLimitPerMin - r.count)));
    if (!r.ok) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      throw new DomainError('RATE_LIMITED', { retryAfterSec: r.retryAfterSec });
    }
    req.apiKey = { id: key.id, scopes: key.scopes };
    // At most one write per key per minute: lastUsedAt is informational.
    const stale = new Date(Date.now() - API_KEY_POLICY.touchEverySec * 1000);
    if (!key.lastUsedAt || key.lastUsedAt < stale)
      void this.prisma.apiKey
        .updateMany({
          where: { id: key.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: stale } }] },
          data: { lastUsedAt: new Date() },
        })
        .catch((e: unknown) => this.logger.warn(`lastUsedAt: ${String(e)}`));
    return true;
  }
}
