import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common';
import {
  type ArticleDto,
  type ArticleListDto,
  type ArticleListQuery,
  articleListQuerySchema,
  type BrandStoryDto,
  cmsSlugSchema,
  type Locale,
} from '@forest/contracts';
import { CatalogModule } from '../catalog/catalog.module';
import { ReqLocale, ZodPipe } from '../common/http';
import { ContentService } from '../customer/content/content.service';
import { CmsPublicService } from './cms-public.service';

const CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** Storefront Ilhom/Brend reads (`/v1/content/articles`, `/v1/content/brand`). */
@Controller('content')
export class CmsController {
  constructor(private readonly cms: CmsPublicService) {}

  @Get('articles')
  @Header('Cache-Control', CACHE)
  list(
    @ReqLocale() locale: Locale,
    @Query(new ZodPipe(articleListQuerySchema)) q: ArticleListQuery,
  ): Promise<ArticleListDto> {
    return this.cms.list(locale, q);
  }

  @Get('articles/:slug')
  @Header('Cache-Control', CACHE)
  article(
    @ReqLocale() locale: Locale,
    @Param('slug', new ZodPipe(cmsSlugSchema)) slug: string,
  ): Promise<ArticleDto> {
    return this.cms.article(locale, slug);
  }

  @Get('brand')
  @Header('Cache-Control', CACHE)
  brand(@ReqLocale() locale: Locale): Promise<BrandStoryDto> {
    return this.cms.brand(locale);
  }
}

@Module({
  imports: [CatalogModule],
  controllers: [CmsController],
  providers: [CmsPublicService, ContentService],
  exports: [CmsPublicService],
})
export class CmsModule {}
