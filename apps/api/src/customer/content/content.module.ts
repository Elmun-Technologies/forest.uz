import { Controller, Get, Header, Module, Param } from '@nestjs/common';
import { type ContentPageDto, type HomeContentDto, type Locale } from '@forest/contracts';
import { z } from 'zod';
import { CatalogModule } from '../../catalog/catalog.module';
import { ReqLocale, ZodPipe } from '../../common/http';
import { ContentService } from './content.service';

const CACHE = 'public, max-age=60, stale-while-revalidate=300';
const segment = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('home')
  @Header('Cache-Control', CACHE)
  home(@ReqLocale() locale: Locale): Promise<HomeContentDto> {
    return this.content.home(locale);
  }

  @Get('pages/:kind/:slug')
  @Header('Cache-Control', CACHE)
  page(
    @Param('kind', new ZodPipe(segment)) kind: string,
    @Param('slug', new ZodPipe(segment)) slug: string,
    @ReqLocale() locale: Locale,
  ): Promise<ContentPageDto> {
    return this.content.page(kind, slug, locale);
  }
}

@Module({
  imports: [CatalogModule],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
