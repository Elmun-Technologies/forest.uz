import {
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DomainError, devAdminTotpSchema } from '@forest/contracts';
import type { z } from 'zod';
import { assertDevEndpoints, DevEndpointsGuard } from '../../common/dev-endpoints';
import { ZodPipe } from '../../common/http';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { parseKey, SecretBox } from '../../integrations/crypto/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import { totpAad } from './admin-auth.service';
import { base32Decode, hotp, TOTP_WINDOW, totpStep } from './totp';

/**
 * Dev/e2e only: the TOTP code of a staff member, so Playwright can pass the admin 2FA step.
 * Returns the code of the next step the replay rule accepts (the current one, or the next when
 * the current was just used). 404 unless DEV_ENDPOINTS=true and PROVIDERS_MODE=fake, the
 * X-Dev-Token matches, and — with NODE_ENV=production — ALLOW_DEV_ADMIN_TOTP=true.
 */
@Controller('dev')
@UseGuards(DevEndpointsGuard)
export class DevAdminController {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox({ current: parseKey(env.APP_ENCRYPTION_KEY) });
  }

  @Post('admin-totp')
  @HttpCode(200)
  async totp(
    @Body(new ZodPipe(devAdminTotpSchema)) body: z.infer<typeof devAdminTotpSchema>,
  ): Promise<{ code: string; step: number }> {
    assertDevEndpoints(this.env);
    // It turns admin 2FA into password-only: never on a public demo, only CI e2e opts in.
    if (this.env.NODE_ENV === 'production' && !this.env.ALLOW_DEV_ADMIN_TOTP)
      throw new NotFoundException();
    const staff = await this.prisma.staff.findUnique({ where: { email: body.email } });
    if (!staff?.totpSecret) throw new NotFoundException();
    const secret = this.box.decrypt(staff.totpSecret, totpAad(staff.id)).toString('utf8');
    const current = totpStep(Date.now());
    const step = Math.max(current, (staff.totpLastUsedStep ?? -1) + 1);
    if (step > current + TOTP_WINDOW) throw new DomainError('RATE_LIMITED', { retryAfterSec: 30 });
    return { code: hotp(base32Decode(secret), step), step };
  }
}
