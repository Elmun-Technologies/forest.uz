import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  addCartItemSchema,
  applyPromoSchema,
  type CartDto,
  type DeliveryOptionDto,
  type Locale,
  quoteQuerySchema,
  setCartQtySchema,
} from '@forest/contracts';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ReqLocale, ZodPipe } from '../common/http';
import { SessionService, visitorId } from '../common/session';
import { CartService } from './cart.service';

function hashVisitor(aid: string): string {
  return createHash('sha256').update(aid).digest('hex').slice(0, 32);
}

/** Device fingerprint for "one code per device": hash of the first-party visitor cookie `fr_aid`. */
export function deviceHash(req: Request): string | null {
  const aid = visitorId(req);
  return aid ? hashVisitor(aid) : null;
}

@Controller('cart')
export class CartController {
  constructor(
    private readonly carts: CartService,
    private readonly sessions: SessionService,
  ) {}

  /** Every cart write makes sure the browser carries a visitor id (device rule for promo codes). */
  private device(req: Request, res: Response): string {
    return hashVisitor(this.sessions.ensureVisitorId(req, res));
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @Req() req: Request,
    @ReqLocale() locale: Locale,
    @Query('zone') zoneKey?: string,
  ): Promise<CartDto> {
    const cart = await this.carts.current(req);
    const zone = zoneKey ? await this.carts.zoneByKey(zoneKey) : undefined;
    return this.carts.toDto(cart, locale, zone);
  }

  @Post('items')
  @Header('Cache-Control', 'no-store')
  async add(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(addCartItemSchema)) body: z.infer<typeof addCartItemSchema>,
    @ReqLocale() locale: Locale,
  ): Promise<CartDto> {
    this.device(req, res);
    return this.carts.toDto(await this.carts.addItem(req, res, body.variantId, body.qty), locale);
  }

  @Patch('items/:variantId')
  @Header('Cache-Control', 'no-store')
  async setQty(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(setCartQtySchema)) body: z.infer<typeof setCartQtySchema>,
    @ReqLocale() locale: Locale,
  ): Promise<CartDto> {
    this.device(req, res);
    return this.carts.toDto(await this.carts.setQty(req, variantId, body.qty), locale);
  }

  @Delete('items/:variantId')
  @Header('Cache-Control', 'no-store')
  async remove(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('variantId') variantId: string,
    @ReqLocale() locale: Locale,
  ): Promise<CartDto> {
    this.device(req, res);
    return this.carts.toDto(await this.carts.setQty(req, variantId, 0), locale);
  }

  @Post('promo')
  @Header('Cache-Control', 'no-store')
  async applyPromo(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(applyPromoSchema)) body: z.infer<typeof applyPromoSchema>,
    @ReqLocale() locale: Locale,
  ): Promise<CartDto> {
    return this.carts.toDto(
      await this.carts.setPromo(req, res, body.code, this.device(req, res)),
      locale,
    );
  }

  @Delete('promo')
  @Header('Cache-Control', 'no-store')
  async removePromo(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ReqLocale() locale: Locale,
  ): Promise<CartDto> {
    return this.carts.toDto(
      await this.carts.setPromo(req, res, null, this.device(req, res)),
      locale,
    );
  }

  @Get('quote')
  @Header('Cache-Control', 'no-store')
  async quote(
    @Req() req: Request,
    @Query(new ZodPipe(quoteQuerySchema)) q: z.infer<typeof quoteQuerySchema>,
    @ReqLocale() locale: Locale,
  ): Promise<DeliveryOptionDto[]> {
    return this.carts.quote(await this.carts.current(req), q.region, q.district ?? null, locale);
  }
}
