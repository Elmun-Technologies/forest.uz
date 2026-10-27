import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  isRevalidateTag,
  REVALIDATE_HEADER,
  revalidateKey,
  signRevalidate,
} from './revalidate-signature';

/**
 * On-demand storefront revalidation (CLAUDE.md §6): after a committed admin save the API asks the
 * web server to drop cached fetches/pages carrying these tags. Fire-and-forget — a failure only
 * means the page refreshes at its ISR interval, so it is logged, never thrown.
 */
@Injectable()
export class WebRevalidateService {
  private readonly logger = new Logger('WebRevalidate');
  private readonly key: Buffer;
  private readonly target: string | null;
  private readonly inflight = new Set<Promise<void>>();

  constructor(@Inject(ENV) env: Env) {
    this.key = revalidateKey(env.APP_ENCRYPTION_KEY);
    // Tests reach a web server only when they stub one (never the developer's running storefront).
    const base = env.WEB_INTERNAL_URL ?? (env.NODE_ENV === 'test' ? null : env.APP_URL);
    this.target = base ? `${base.replace(/\/$/, '')}/api/revalidate` : null;
  }

  /** Queue a revalidation of `tags`; returns at once. */
  revalidate(tags: readonly string[], reason: string): void {
    const unique = [...new Set(tags)].filter(isRevalidateTag);
    if (!this.target || unique.length === 0) return;
    const p = this.send(unique, reason).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Product pages and every listing that shows product cards. */
  product(slugs: readonly (string | null | undefined)[], reason: string): void {
    const tags = slugs.filter((s): s is string => !!s).map((s) => `product:${s}`);
    this.revalidate([...tags, 'catalog', 'content'], reason);
  }

  /** Waits for queued calls (tests, graceful shutdown). */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private async send(tags: string[], reason: string): Promise<void> {
    const body = JSON.stringify({ tags });
    try {
      const res = await fetch(this.target!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [REVALIDATE_HEADER]: signRevalidate(this.key, body),
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok)
        this.logger.warn(`revalidate ${reason} → HTTP ${res.status} (${tags.join(', ')})`);
    } catch (e) {
      this.logger.warn(
        `revalidate ${reason} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
