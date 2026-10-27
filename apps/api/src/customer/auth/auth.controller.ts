import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type Locale,
  type MeDto,
  type TelegramAuthInput,
  otpSendSchema,
  otpVerifySchema,
  telegramAuthSchema,
} from '@forest/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ReqLocale, ZodPipe } from '../../common/http';
import { SessionService } from '../../common/session';
import { PrismaService } from '../../prisma/prisma.service';
import { MeService } from '../me/me.service';
import { CustomerSignIn } from './customer-sign-in.service';
import { CustomerGuard, CustomerId } from './customer.guard';
import { type OtpSendResult, OtpService } from './otp.service';
import { TelegramAuthService } from './telegram-auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramAuthService,
    private readonly signer: CustomerSignIn,
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
    return this.signIn(req, res, customer.id);
  }

  /** Telegram Login Widget payload (hash-verified) → same session as an OTP login. */
  @Post('telegram')
  @HttpCode(200)
  async telegramLogin(
    @Body(new ZodPipe(telegramAuthSchema)) body: TelegramAuthInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ReqLocale() locale: Locale,
  ): Promise<MeDto> {
    const user = await this.telegram.verify(body, req.ip ?? null);
    return this.signIn(req, res, await this.telegram.findOrCreate(user, locale));
  }

  private signIn(req: Request, res: Response, customerId: string): Promise<MeDto> {
    return this.signer.signIn(req, res, customerId);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.destroy(req, res);
  }
}

/** Attach Telegram to the signed-in (OTP) customer: same widget verification as the login. */
@Controller('me/telegram')
@UseGuards(CustomerGuard)
export class TelegramLinkController {
  constructor(
    private readonly telegram: TelegramAuthService,
    private readonly me: MeService,
  ) {}

  @Post('link')
  @HttpCode(200)
  async link(
    @CustomerId() customerId: string,
    @Body(new ZodPipe(telegramAuthSchema)) body: TelegramAuthInput,
    @Req() req: Request,
  ): Promise<MeDto> {
    const user = await this.telegram.verify(body, req.ip ?? null);
    await this.telegram.link(customerId, user);
    return this.me.me(customerId);
  }
}
