import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  DomainError,
  type Locale,
  type RedirectDto,
  type SeoMetaPublicDto,
  type SeoPublicConfigDto,
  notFoundReportSchema,
  redirectQuerySchema,
  seoMetaQuerySchema,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../../common/http';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FilesService } from '../../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { SitemapService, siteBase } from '../../seo/sitemap.service';
import { defaultRobots, normalizeRobots } from '../../seo/robots';
import { CustomerCommonModule } from '../common/customer-common.module';
import { RateLimiter } from '../common/rate-limit';
import { normalizePath, normalizeReferrer, redirectCandidates } from './seo-paths';

@Injectable()
export class SeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async redirect(rawPath: string): Promise<RedirectDto> {
    const path = normalizePath(rawPath);
    if (!path) throw new DomainError('NOT_FOUND');
    const candidates = redirectCandidates(path);
    const rows = await this.prisma.redirect.findMany({ where: { from: { in: candidates } } });
    const hit = candidates.map((c) => rows.find((r) => r.from === c)).find(Boolean);
    if (!hit) throw new DomainError('NOT_FOUND');
    await this.prisma.redirect.update({
      where: { id: hit.id },
      data: { hits: { increment: 1 }, lastHitAt: new Date() },
    });
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

  /** Admin override for one page (A9 / product editor); null = the storefront's template. */
  async meta(path: string, locale: Locale): Promise<SeoMetaPublicDto> {
    const row = await this.prisma.seoMeta.findUnique({ where: { path_locale: { path, locale } } });
    if (!row) return { meta: null };
    const file = row.ogImageId
      ? await this.prisma.file.findUnique({ where: { id: row.ogImageId } })
      : null;
    return {
      meta: {
        title: row.title.trim() || null,
        description: row.description.trim() || null,
        ogImage: file?.isPublic
          ? { url: this.files.publicUrl(file.key), width: file.width, height: file.height }
          : null,
        noindex: row.noindex,
        canonical: row.canonical,
      },
    };
  }

  async publicConfig(): Promise<SeoPublicConfigDto> {
    return { schema: await this.settings.get('seo.schema') };
  }

  async robots(): Promise<string> {
    const { custom } = await this.settings.get('seo.robots');
    return custom?.trim() ? normalizeRobots(custom) : defaultRobots(siteBase(this.env));
  }

  /** IndexNow key file body, only for the current key. */
  async indexNowKey(file: string): Promise<string | null> {
    const { key } = await this.settings.get('seo.indexnow');
    return file === key || file === `${key}.txt` ? key : null;
  }
}

/**
 * Public SEO endpoints. `/robots.txt`, `/sitemap.xml`, `/sitemaps/*` and `/<key>.txt` reach the
 * `.txt`/`.xml` routes through the storefront's rewrites (next.config.ts).
 */
@Controller('seo')
export class SeoController {
  constructor(
    private readonly seo: SeoService,
    private readonly sitemaps: SitemapService,
    private readonly limiter: RateLimiter,
  ) {}

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

  /** Storefront metadata (fetch-cached by the web app, refreshed on demand after admin saves). */
  @Get('meta')
  @Header('Cache-Control', 'public, max-age=60')
  meta(
    @Query(new ZodPipe(seoMetaQuerySchema)) q: z.infer<typeof seoMetaQuerySchema>,
  ): Promise<SeoMetaPublicDto> {
    return this.seo.meta(q.path, q.locale);
  }

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60')
  publicConfig(): Promise<SeoPublicConfigDto> {
    return this.seo.publicConfig();
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  robots(): Promise<string> {
    return this.seo.robots();
  }

  @Get('sitemap.xml')
  sitemapIndex(@Res() res: Response): Promise<void> {
    return this.sendSitemap('sitemap.xml', res);
  }

  @Get('sitemaps/:file')
  sitemapFile(@Param('file') file: string, @Res() res: Response): Promise<void> {
    return this.sendSitemap(file, res);
  }

  @Get('indexnow/:file')
  async indexNowKey(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const key = await this.seo.indexNowKey(file);
    if (!key) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(key);
  }

  private async sendSitemap(name: string, res: Response): Promise<void> {
    const xml = await this.sitemaps.file(name);
    if (xml === null) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.type('application/xml; charset=utf-8').setHeader('Cache-Control', 'public, max-age=300');
    res.send(xml);
  }
}

@Module({
  imports: [CustomerCommonModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
