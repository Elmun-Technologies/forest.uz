import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IndexNowService } from './indexnow.service';
import { SitemapService } from './sitemap.service';
import { WebRevalidateService } from './web-revalidate.service';

/**
 * What a committed admin save means for the storefront (CLAUDE.md §6): revalidate cached pages,
 * rebuild the sitemap (debounced) and ping IndexNow for public URLs. Every method is called after
 * commit and never throws — a failure only delays freshness.
 */
@Injectable()
export class SeoEventsService {
  private readonly logger = new Logger('SeoEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly web: WebRevalidateService,
    private readonly sitemap: SitemapService,
    private readonly indexNow: IndexNowService,
  ) {}

  /**
   * A product (or its variants, images, relations, SEO) changed. `slugs` = every slug its page
   * had in this change (old + new); `wasPublic` = it was ACTIVE before the change.
   */
  async productChanged(productId: string, opts: { slugs?: string[]; wasPublic?: boolean } = {}) {
    try {
      const p = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { slug: true, status: true },
      });
      const slugs = [...new Set([...(opts.slugs ?? []), ...(p ? [p.slug] : [])])];
      this.web.product(slugs, 'product');
      const isPublic = p?.status === 'ACTIVE';
      if (isPublic || opts.wasPublic) {
        await this.sitemap.schedule();
        await this.indexNow.enqueue(slugs.map((s) => `/p/${s}`));
      }
    } catch (e) {
      this.logger.warn(`productChanged ${productId}: ${String(e)}`);
    }
  }

  /** A page's SEO override changed (A9). */
  async pageMetaChanged(path: string): Promise<void> {
    try {
      const product = /^\/p\/([^/]+)$/.exec(path)?.[1];
      this.web.revalidate([`seo:${path}`, ...(product ? [`product:${product}`] : [])], 'seo-meta');
      await this.sitemap.schedule();
      await this.indexNow.enqueue([path]);
    } catch (e) {
      this.logger.warn(`pageMetaChanged ${path}: ${String(e)}`);
    }
  }

  /** Public settings changed (store/delivery: `settings`; A9 site settings also `seo`). */
  settingsChanged(tags: ('settings' | 'seo')[]): void {
    this.web.revalidate(tags, 'settings');
  }

  /** Review moderation changed a product's rating/reviews or the home gallery. */
  reviewsChanged(productSlug: string | null): void {
    this.web.revalidate([...(productSlug ? [`product:${productSlug}`] : []), 'content'], 'reviews');
  }
}
