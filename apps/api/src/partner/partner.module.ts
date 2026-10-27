import { Controller, Get, Header, Module, Param, Query, UseGuards } from '@nestjs/common';
import {
  type PartnerListQuery,
  partnerListQuerySchema,
  type PartnerProductDto,
  type PartnerProductPageDto,
  type PartnerStockDto,
  type PartnerStockQuery,
  partnerStockQuerySchema,
} from '@forest/contracts';
import { z } from 'zod';
import { ZodPipe } from '../common/http';
import { RateLimiter } from '../customer/common/rate-limit';
import { ApiKeyGuard, RequireScopes } from './api-key.guard';
import { PartnerService } from './partner.service';

const slug = z.string().regex(/^[a-z0-9-]{1,96}$/);

/**
 * `/v1/partner/*` — read-only REST for n8n/Make/Zapier with an API key (docs/06; endpoints and
 * scopes in docs/runbooks/webhooks-and-api.md). Not the admin: no session, no CSRF.
 */
@Controller('partner')
@UseGuards(ApiKeyGuard)
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Get('products')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('products:read')
  products(
    @Query(new ZodPipe(partnerListQuerySchema)) q: PartnerListQuery,
  ): Promise<PartnerProductPageDto> {
    return this.partner.products(q);
  }

  @Get('products/:slug')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('products:read')
  product(@Param('slug', new ZodPipe(slug)) s: string): Promise<PartnerProductDto> {
    return this.partner.product(s);
  }

  @Get('stock')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('stock:read')
  stock(
    @Query(new ZodPipe(partnerStockQuerySchema)) q: PartnerStockQuery,
  ): Promise<PartnerStockDto> {
    return this.partner.stock(q);
  }
}

@Module({
  controllers: [PartnerController],
  providers: [PartnerService, ApiKeyGuard, RateLimiter],
})
export class PartnerModule {}
