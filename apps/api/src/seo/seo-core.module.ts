import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { CwvService } from './cwv.service';
import { IndexNowService } from './indexnow.service';
import { SearchQueriesService } from './search-queries.service';
import { SeoEventsService } from './seo-events.service';
import { SeoInventoryService } from './seo-inventory.service';
import { INDEXNOW_FLUSH, QUERIES_SYNC, SEO_QUEUE, SITEMAP_REGENERATE } from './seo-queue';
import { SitemapService } from './sitemap.service';
import { WebRevalidateService } from './web-revalidate.service';

/** Dispatches the `seo` queue (CLAUDE.md §5). */
@Processor(SEO_QUEUE)
export class SeoProcessor extends WorkerHost {
  constructor(
    private readonly sitemap: SitemapService,
    private readonly indexNow: IndexNowService,
    private readonly queries: SearchQueriesService,
  ) {
    super();
  }

  async process(job: Job<{ reason?: string }>): Promise<unknown> {
    switch (job.name) {
      case SITEMAP_REGENERATE:
        return this.sitemap.regenerate(job.data.reason ?? 'schedule');
      case INDEXNOW_FLUSH:
        return this.indexNow.flush();
      case QUERIES_SYNC:
        return this.queries.sync();
      default:
        return undefined;
    }
  }
}

@Injectable()
export class SeoScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger('SeoScheduler');

  constructor(@InjectQueue(SEO_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // docs/10: sitemap daily 06:00; query stats after the providers' nightly updates.
      await this.queue.upsertJobScheduler(
        SITEMAP_REGENERATE,
        { pattern: '0 6 * * *', tz: 'Asia/Tashkent' },
        { name: SITEMAP_REGENERATE, data: { reason: 'daily' } },
      );
      await this.queue.upsertJobScheduler(
        QUERIES_SYNC,
        { pattern: '40 5 * * *', tz: 'Asia/Tashkent' },
        { name: QUERIES_SYNC },
      );
    } catch (e) {
      this.logger.warn(`schedule failed: ${String(e)}`);
    }
  }
}

/**
 * SEO center core (A9, CLAUDE.md §6): page inventory, sitemaps, IndexNow, search-engine queries,
 * CWV, and the after-save hooks (`SeoEventsService`) admin services call. Global so domain
 * modules can inject the hooks without re-wiring.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: SEO_QUEUE })],
  providers: [
    WebRevalidateService,
    SeoInventoryService,
    SitemapService,
    IndexNowService,
    SearchQueriesService,
    CwvService,
    SeoEventsService,
    SeoProcessor,
    SeoScheduler,
  ],
  exports: [
    WebRevalidateService,
    SeoInventoryService,
    SitemapService,
    IndexNowService,
    SearchQueriesService,
    CwvService,
    SeoEventsService,
  ],
})
export class SeoCoreModule {}
