import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainError, type ErrorCode } from '@forest/contracts';
import { RedisService } from '../../redis/redis.module';

export interface RateLimitResult {
  ok: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counters in Redis. Identifiers (phones, IPs) are hashed so Redis keys hold no PII.
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  private key(scope: string, id: string): string {
    return `rl:${scope}:${createHash('sha256').update(id).digest('base64url').slice(0, 22)}`;
  }

  async hit(scope: string, id: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const key = this.key(scope, id);
    const res = await this.redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { ok: count <= limit, count, retryAfterSec: ttl > 0 ? ttl : windowSec };
  }

  /** Current count of a window without counting a hit (0 when the window isn't open). */
  async peek(scope: string, id: string): Promise<{ count: number; retryAfterSec: number }> {
    const key = this.key(scope, id);
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    return { count: Number(count ?? 0), retryAfterSec: ttl > 0 ? ttl : 0 };
  }

  /** Throws `code` (429) when the window is exhausted. */
  async consume(
    scope: string,
    id: string,
    limit: number,
    windowSec: number,
    code: ErrorCode = 'RATE_LIMITED',
  ): Promise<void> {
    const r = await this.hit(scope, id, limit, windowSec);
    if (!r.ok) throw new DomainError(code, { retryAfterSec: r.retryAfterSec });
  }

  /** True only for the first call within the window (dedupe of side effects such as SMS). */
  async once(scope: string, id: string, windowSec: number): Promise<boolean> {
    const set = await this.redis.set(this.key(scope, id), '1', 'EX', windowSec, 'NX');
    return set === 'OK';
  }
}
