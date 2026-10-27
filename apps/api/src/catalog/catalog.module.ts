import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common';
import {
  type CategoryDto,
  type Locale,
  type ProductCardDto,
  type ProductDetailDto,
  type ProductListDto,
  type ProductListQuery,
  type ProductReviewsDto,
  productListQuerySchema,
  productReviewsQuerySchema,
} from '@forest/contracts';
import { ReqLocale, ZodPipe } from '../common/http';
import { CatalogService } from './catalog.service';

const CACHE = 'public, max-age=30, stale-while-revalidate=300';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @Header('Cache-Control', CACHE)
  categories(@ReqLocale() locale: Locale): Promise<CategoryDto[]> {
    return this.catalog.categories(locale);
  }

  @Get('products')
  @Header('Cache-Control', CACHE)
  list(
    @Query(new ZodPipe(productListQuerySchema)) q: ProductListQuery,
    @ReqLocale() locale: Locale,
  ): Promise<ProductListDto> {
    return this.catalog.list(q, locale);
  }

  @Get('bestsellers')
  @Header('Cache-Control', CACHE)
  bestsellers(@ReqLocale() locale: Locale): Promise<ProductCardDto[]> {
    return this.catalog.bestsellers(locale);
  }

  @Get('products/:slug')
  @Header('Cache-Control', CACHE)
  detail(@Param('slug') slug: string, @ReqLocale() locale: Locale): Promise<ProductDetailDto> {
    return this.catalog.detail(slug, locale);
  }

  @Get('products/:slug/reviews')
  @Header('Cache-Control', CACHE)
  reviews(
    @Param('slug') slug: string,
    @Query(new ZodPipe(productReviewsQuerySchema)) q: { page: number },
    @ReqLocale() locale: Locale,
  ): Promise<ProductReviewsDto> {
    return this.catalog.reviews(slug, q.page, locale);
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
