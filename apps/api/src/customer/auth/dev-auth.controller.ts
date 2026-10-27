import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Locale, MeDto } from '@forest/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { assertDevEndpoints, DevEndpointsGuard } from '../../common/dev-endpoints';
import { ReqLocale, ZodPipe } from '../../common/http';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CustomerSignIn } from './customer-sign-in.service';
import { TelegramAuthService } from './telegram-auth.service';

const devTelegramLoginSchema = z.object({
  id: z.string().regex(/^\d{1,15}$/),
  first_name: z.string().max(64).optional(),
  username: z.string().max(64).optional(),
});

/**
 * Dev/e2e only: a Telegram login without the widget signature, so tests can create real
 * Telegram-only (phone-less) customers. 404 unless DEV_ENDPOINTS=true and PROVIDERS_MODE=fake.
 */
@Controller('dev')
@UseGuards(DevEndpointsGuard)
export class DevAuthController {
  constructor(
    private readonly telegram: TelegramAuthService,
    private readonly signer: CustomerSignIn,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('telegram-login')
  @HttpCode(200)
  async telegramLogin(
    @Body(new ZodPipe(devTelegramLoginSchema)) body: z.infer<typeof devTelegramLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ReqLocale() locale: Locale,
  ): Promise<MeDto> {
    assertDevEndpoints(this.env);
    const customerId = await this.telegram.findOrCreate(
      {
        id: BigInt(body.id),
        username: body.username ?? null,
        firstName: body.first_name ?? null,
        lastName: null,
      },
      locale,
    );
    return this.signer.signIn(req, res, customerId);
  }
}
