import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@forest/contracts';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { type InventoryPage, SeoInventoryService } from './seo-inventory.service';
import { SEO_DEBOUNCE_MS, SEO_QUEUE, SITEMAP_REGENERATE } from './seo-queue';
import { buildSitemaps, type SitemapEntry, type SitemapGroup } from './sitemap-xml';

const KEY = (name: string) => `seo:sitemap:file:${name}`;
const STATUS_KEY = 'seo:sitemap:status';
const FILES_KEY = 'seo:sitemap:files';
const LOCK_KEY = 'seo:sitemap:lock';
const LOCK_TTL_S = 60;
/** Files outlive the daily rebuild by a day; a miss is rebuilt on request. */
const TTL_S = 2 * 86_400;

export interface SitemapStatus {
  generatedAt: string;
  urls: number;
  reason: string;
  files: { name: string; urls: number }[];
}

export const siteBase = (env: Env) => env.APP_URL.replace(/\/$/, '');

/**
 * docs/10 sitemaps (CLAUDE.md §6): built from the page inventory minus page-locales an admin set
 * to noindex or canonicalised elsewhere, stored in Redis, served by `/v1/seo/sitemap*.xml` through
 * the storefront rewrite.
 */
@Injectable()
export class SitemapService {
  private readonly logger = new Logger('Sitemap');
  /** In-process single flight (on top of the Redis lock shared by all API processes). */
  private building: Promise<SitemapStatus> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inventory: SeoInventoryService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(SEO_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Rebuilds every file. One build at a time across processes (Redis `SET NX` lock); a caller that
   * finds a build running waits for its result instead of starting another.
   */
  regenerate(reason: string, pages?: InventoryPage[]): Promise<SitemapStatus> {
    this.building ??= this.lockedBuild(reason, pages).finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private async lockedBuild(reason: string, pages?: InventoryPage[]): Promise<SitemapStatus> {
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    if ((await this.redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_S, 'NX')) !== 'OK') {
      const before = (await this.status())?.generatedAt;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const now = await this.status();
        if (now && now.generatedAt !== before) return now;
      }
      throw new Error('sitemap build by another process did not finish in 10 s');
    }
    try {
      return await this.build(reason, pages);
    } finally {
      // Release only our own lock (it may have expired and been taken by another build).
      if ((await this.redis.get(LOCK_KEY)) === token) await this.redis.del(LOCK_KEY);
    }
  }

  private async build(reason: string, pages?: InventoryPage[]): Promise<SitemapStatus> {
    const site = siteBase(this.env);
    const [all, excluded] = await Promise.all([
      pages ? Promise.resolve(pages) : this.inventory.pages(),
      this.excludedPageLocales(site),
    ]);
    const groups: Record<SitemapGroup, SitemapEntry[]> = {
      pages: [],
      categories: [],
      products: [],
    };
    for (const p of all) {
      const locales = p.locales.filter((l) => !excluded.has(`${l}:${p.path}`));
      if (locales.length === 0) continue;
      const group: SitemapGroup =
        p.kind === 'product' ? 'products' : p.kind === 'category' ? 'categories' : 'pages';
      groups[group].push({ path: p.path, locales, lastmod: p.lastmod });
    }
    const built = buildSitemaps(site, groups);
    const status: SitemapStatus = {
      generatedAt: new Date().toISOString(),
      urls: built.urls,
      reason,
      files: built.counts,
    };
    const stale = (await this.redis.smembers(FILES_KEY)).filter((n) => !built.files.has(n));
    const multi = this.redis.multi();
    for (const [name, xml] of built.files) multi.set(KEY(name), xml, 'EX', TTL_S);
    if (stale.length) multi.del(...stale.map(KEY));
    multi.del(FILES_KEY);
    multi.sadd(FILES_KEY, ...built.files.keys());
    multi.set(STATUS_KEY, JSON.stringify(status));
    await multi.exec();
    this.logger.log(`sitemap rebuilt (${reason}): ${built.urls} URLs`);
    return status;
  }

  /** XML of `sitemap.xml` or one child file; null = no such file. */
  async file(name: string): Promise<string | null> {
    if (!/^(sitemap|(uz|ru)-(pages|categories|products))\.xml$/.test(name)) return null;
    const cached = await this.redis.get(KEY(name));
    if (cached !== null) return cached;
    // Cache gone (TTL/flush) or never built: one rebuild writes every file (empty ones too).
    await this.regenerate('on-demand');
    return this.redis.get(KEY(name));
  }

  async status(): Promise<SitemapStatus | null> {
    const raw = await this.redis.get(STATUS_KEY);
    return raw ? (JSON.parse(raw) as SitemapStatus) : null;
  }

  /** Debounced rebuild after publish/update bursts (one pending job). */
  async schedule(): Promise<void> {
    await this.queue
      .add(
        SITEMAP_REGENERATE,
        { reason: 'update' },
        {
          jobId: 'sitemap-regenerate',
          delay: SEO_DEBOUNCE_MS,
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((e: unknown) => this.logger.warn(`schedule sitemap: ${String(e)}`));
  }

  /** `${locale}:${path}` of pages whose override says noindex or points the canonical elsewhere. */
  private async excludedPageLocales(site: string): Promise<Set<string>> {
    const rows = await this.prisma.seoMeta.findMany({
      where: { OR: [{ noindex: true }, { canonical: { not: null } }] },
      select: { path: true, locale: true, noindex: true, canonical: true },
    });
    const out = new Set<string>();
    for (const r of rows) {
      const self = `/${r.locale}${r.path === '/' ? '' : r.path}`;
      if (r.noindex || (r.canonical && !isSelfCanonical(r.canonical, self, site)))
        out.add(`${r.locale as Locale}:${r.path}`);
    }
    return out;
  }
}

/** A canonical override equal to the page's own URL is no override. */
export function isSelfCanonical(canonical: string, selfPath: string, site: string): boolean {
  const c = canonical.trim().replace(/\/$/, '');
  return c === selfPath || c === `${site}${selfPath}`;
}
