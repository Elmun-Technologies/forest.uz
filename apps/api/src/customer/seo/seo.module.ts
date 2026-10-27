import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  DomainError,
  type RedirectDto,
  type SitemapDataDto,
  LOCALES,
  isLocale,
  notFoundReportSchema,
  redirectQuerySchema,
} from '@forest/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../../common/http';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerCommonModule } from '../common/customer-common.module';
import { RateLimiter } from '../common/rate-limit';
import { normalizePath, normalizeReferrer, redirectCandidates } from './seo-paths';

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  async sitemapData(): Promise<SitemapDataDto> {
    const [products, categories, pages] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true, updatedAt: true },
        orderBy: { slug: 'asc' },
      }),
      this.prisma.category.findMany({
        orderBy: { sort: 'asc' },
        select: {
          slug: true,
          products: {
            where: { product: { status: 'ACTIVE' } },
            select: { product: { select: { updatedAt: true } } },
          },
        },
      }),
      this.prisma.page.findMany({
        // Home blocks/FAQ are fragments of other pages, not URLs of their own.
        where: { published: true, kind: { in: ['LEGAL', 'ARTICLE', 'VIDEO'] } },
        select: { kind: true, slug: true, locale: true, updatedAt: true },
        orderBy: [{ kind: 'asc' }, { slug: 'asc' }],
      }),
    ]);

    const pageMap = new Map<string, SitemapDataDto['pages'][number]>();
    for (const p of pages) {
      const key = `${p.kind}/${p.slug}`;
      const entry = pageMap.get(key) ?? { kind: p.kind, slug: p.slug, locales: [], updatedAt: '' };
      if (isLocale(p.locale)) entry.locales.push(p.locale);
      const at = p.updatedAt.toISOString();
      if (at > entry.updatedAt) entry.updatedAt = at;
      pageMap.set(key, entry);
    }

    return {
      products: products.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() })),
      // A category changes when its products do (Category has no own timestamp).
      categories: categories.map((c) => {
        const latest = c.products.reduce<Date | null>(
          (m, x) => (m === null || x.product.updatedAt > m ? x.product.updatedAt : m),
          null,
        );
        return { slug: c.slug, updatedAt: latest?.toISOString() ?? null };
      }),
      pages: [...pageMap.values()].map((p) => ({
        ...p,
        locales: LOCALES.filter((l) => p.locales.includes(l)),
      })),
    };
  }

  async redirect(rawPath: string): Promise<RedirectDto> {
    const path = normalizePath(rawPath);
    if (!path) throw new DomainError('NOT_FOUND');
    const candidates = redirectCandidates(path);
    const rows = await this.prisma.redirect.findMany({ where: { from: { in: candidates } } });
    const hit = candidates.map((c) => rows.find((r) => r.from === c)).find(Boolean);
    if (!hit) throw new DomainError('NOT_FOUND');
    await this.prisma.redirect.update({ where: { id: hit.id }, data: { hits: { increment: 1 } } });
    return { to: hit.to, code: hit.code };
  }

  async notFound(input: z.infer<typeof notFoundReportSchema>): Promise<void> {
    const path = normalizePath(input.path);
    if (!path) throw new DomainError('VALIDATION_FAILED', undefined, 'path');
    const referrer = normalizeReferrer(input.referrer);
    await this.prisma.notFoundLog.upsert({
      where: { path },
      create: { path, referrer },
      update: {
        hits: { increment: 1 },
        lastSeen: new Date(),
        ...(referrer ? { referrer } : {}),
      },
    });
  }
}

@Controller('seo')
export class SeoController {
  constructor(
    private readonly seo: SeoService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get('sitemap-data')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  sitemapData(): Promise<SitemapDataDto> {
    return this.seo.sitemapData();
  }

  /** Not cacheable: every lookup counts a hit for the admin redirect manager. */
  @Get('redirect')
  @Header('Cache-Control', 'no-store')
  redirect(
    @Query(new ZodPipe(redirectQuerySchema)) q: z.infer<typeof redirectQuerySchema>,
  ): Promise<RedirectDto> {
    return this.seo.redirect(q.path);
  }

  @Post('not-found')
  @HttpCode(204)
  async notFound(
    @Body(new ZodPipe(notFoundReportSchema)) body: z.infer<typeof notFoundReportSchema>,
    @Req() req: Request,
  ): Promise<void> {
    // Generous: SSR reports come from the web server's IP, not the visitor's.
    await this.limiter.consume('seo:404', req.ip ?? 'unknown', 120, 60);
    await this.seo.notFound(body);
  }
}

@Module({
  imports: [CustomerCommonModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
