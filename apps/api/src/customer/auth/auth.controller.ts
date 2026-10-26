import { Body, Controller, HttpCode, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import { type Locale, type MeDto, otpSendSchema, otpVerifySchema } from '@forest/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ReqLocale, ZodPipe } from '../../common/http';
import { SessionService, cartIdFromCookie, sessionId } from '../../common/session';
import { PrismaService } from '../../prisma/prisma.service';
import { CART_MERGER, type CartMerger } from '../cart-merger';
import { MeService } from '../me/me.service';
import { type OtpSendResult, OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('CustomerAuth');

  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly me: MeService,
    @Inject(CART_MERGER) private readonly carts: CartMerger,
  ) {}

  @Post('otp/send')
  @HttpCode(200)
  send(
    @Body(new ZodPipe(otpSendSchema)) body: z.infer<typeof otpSendSchema>,
    @Req() req: Request,
    @ReqLocale() locale: Locale,
  ): Promise<OtpSendResult> {
    return this.otp.send(body.phone, req.ip ?? null, locale);
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ReqLocale() locale: Locale,
  ): Promise<MeDto> {
    await this.otp.verify(body.phone, body.code);
    const customer = await this.prisma.customer.upsert({
      where: { phone: body.phone },
      create: { phone: body.phone, locale },
      update: {},
      select: { id: true },
    });
    // Rotate: a pre-login session id (possibly planted) never becomes an authenticated one.
    await this.sessions.create(res, customer.id, sessionId(req));
    try {
      await this.carts.mergeAnonymousCart(cartIdFromCookie(req), customer.id);
    } catch (e) {
      // Login must not fail because of the cart; the anonymous cart stays usable.
      this.logger.warn(`cart merge failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return this.me.me(customer.id);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.destroy(req, res);
  }
}
