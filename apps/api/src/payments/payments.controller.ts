import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { type ClickResponse, ClickShopService } from './click-shop.service';
import { PaymeMerchantService, type PaymeRpcResponse } from './payme-merchant.service';

/**
 * Inbound payment webhooks. Providers expect HTTP 200 with their own error envelope for every
 * outcome (JSON-RPC errors for Payme, `error` field for Click), never Nest's error JSON.
 * Authentication (Basic key / md5 sign) happens in the services before anything is read.
 */
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(
    private readonly payme: PaymeMerchantService,
    private readonly click: ClickShopService,
  ) {}

  @Post('payme')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  paymeRpc(@Req() req: Request, @Body() body: unknown): Promise<PaymeRpcResponse> {
    return this.payme.handle(body, req.header('authorization'), req.ip ?? null);
  }

  @Post('click/prepare')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  clickPrepare(@Body() body: unknown): Promise<ClickResponse> {
    return this.click.prepare(body);
  }

  @Post('click/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  clickComplete(@Body() body: unknown): Promise<ClickResponse> {
    return this.click.complete(body);
  }
}
