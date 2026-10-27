import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { LOCALES } from '@forest/contracts';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  INDEXNOW_MAX_URLS,
  indexNowPayloads,
  isPublicSite,
  submitIndexNow,
} from '../integrations/providers/seo-tools';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { INDEXNOW_FLUSH, SEO_DEBOUNCE_MS, SEO_QUEUE } from './seo-queue';
import { siteBase } from './sitemap.service';

const PENDING = 'seo:indexnow:pending';
export const INDEXNOW_LOG_KEY = 'indexnow';

/**
 * IndexNow pings (docs/10, CLAUDE.md §6): changed URLs are collected in Redis and sent in one
 * debounced POST to Yandex and Bing. The key file is served at `/<key>.txt` by the storefront
 * rewrite → `GET /v1/seo/indexnow/:key`.
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger('IndexNow');

  constructor(
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(SEO_QUEUE) private readonly queue: Queue,
  ) {}

  /** Absolute URLs of a locale-less page path in every locale. */
  urlsOf(path: string): string[] {
    const site = siteBase(this.env);
    return LOCALES.map((l) => `${site}/${l}${path === '/' ? '' : path}`);
  }

  async enqueue(paths: string[]): Promise<void> {
    const urls = paths.flatMap((p) => this.urlsOf(p));
    if (urls.length === 0) return;
    try {
      await this.redis.sadd(PENDING, ...urls);
      await this.scheduleFlush();
    } catch (e) {
      this.logger.warn(`enqueue failed: ${String(e)}`);
    }
  }

  private async scheduleFlush(): Promise<void> {
    await this.queue.add(
      INDEXNOW_FLUSH,
      {},
      {
        jobId: 'indexnow-flush',
        delay: SEO_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  pending(): Promise<number> {
    return this.redis.scard(PENDING);
  }

  async flush(): Promise<{ sent: number; skipped: string | null }> {
    const { enabled, key } = await this.settings.get('seo.indexnow');
    const urls = (await this.redis.spop(PENDING, INDEXNOW_MAX_URLS)) ?? [];
    if (urls.length === 0) return { sent: 0, skipped: null };
    const site = siteBase(this.env);
    const skipped = !enabled
      ? 'disabled in the SEO center'
      : this.integrations.fakeMode
        ? 'fake mode: no external call made'
        : !isPublicSite(site)
          ? `APP_URL ${site} is not a public https host`
          : null;
    if (skipped) {
      await this.log(true, `${urls.length} URL(s) not sent: ${skipped}`, {
        urls: urls.slice(0, 20),
      });
      return { sent: 0, skipped };
    }
    let sent = 0;
    for (const payload of indexNowPayloads(site, key, urls)) {
      const results = await submitIndexNow(
        this.integrations.httpClient('indexnow', { maxRetries: 1 }),
        payload,
      );
      const ok = results.every((r) => r.ok);
      if (ok) sent += payload.urlList.length;
      await this.log(
        ok,
        `${payload.urlList.length} URL(s): ${results.map((r) => `${new URL(r.endpoint).host} ${r.message}`).join('; ')}`,
        { urls: payload.urlList.slice(0, 20) },
      );
    }
    if ((await this.pending()) > 0) await this.scheduleFlush();
    return { sent, skipped: null };
  }

  async lastPing(): Promise<{ at: string; ok: boolean; message: string } | null> {
    const row = await this.prisma.integrationLog.findFirst({
      where: { integrationKey: INDEXNOW_LOG_KEY },
      orderBy: { createdAt: 'desc' },
    });
    return row ? { at: row.createdAt.toISOString(), ok: row.ok, message: row.message } : null;
  }

  private async log(ok: boolean, message: string, payload: unknown): Promise<void> {
    await this.integrations
      .log(INDEXNOW_LOG_KEY, { direction: 'OUT', kind: 'indexnow.submit', ok, message, payload })
      .catch((e: unknown) => this.logger.warn(`log failed: ${String(e)}`));
  }
}
