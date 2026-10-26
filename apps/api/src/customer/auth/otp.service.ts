import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type Locale } from '@forest/contracts';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { TemplateSms } from '../common/messaging';
import { RateLimiter } from '../common/rate-limit';
import { OTP_POLICY, generateOtpCode, hashOtp, otpMatches } from './otp-code';

export interface OtpSendResult {
  resendInSec: number;
  expiresInSec: number;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly sms: TemplateSms,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(phone: string, ip: string | null, locale: Locale): Promise<OtpSendResult> {
    await this.limiter.consume('otp:phone', phone, 1, OTP_POLICY.resendSec, 'OTP_RATE_LIMITED');
    await this.limiter.consume(
      'otp:ip',
      ip ?? 'unknown',
      OTP_POLICY.sendsPerIpPerHour,
      3600,
      'OTP_RATE_LIMITED',
    );

    const code = generateOtpCode();
    const now = new Date();
    await this.prisma.$transaction([
      // Only the newest code is valid: a resend supersedes earlier ones.
      this.prisma.otpCode.updateMany({
        where: { phone, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          codeHash: hashOtp(phone, code, this.env.SESSION_SECRET),
          expiresAt: new Date(now.getTime() + OTP_POLICY.ttlSec * 1000),
          ip,
        },
      }),
    ]);
    await this.sms.send({ phone, templateKey: 'otp', locale, vars: { kod: code }, record: false });
    return { resendInSec: OTP_POLICY.resendSec, expiresInSec: OTP_POLICY.ttlSec };
  }

  /** Consumes the code or throws OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS. */
  async verify(phone: string, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new DomainError('OTP_INVALID', undefined, 'code');
    if (otp.expiresAt.getTime() <= Date.now())
      throw new DomainError('OTP_EXPIRED', undefined, 'code');

    // Count the attempt atomically before comparing so parallel guesses can't exceed the cap.
    const counted = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, usedAt: null, attempts: { lt: OTP_POLICY.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw new DomainError('OTP_TOO_MANY_ATTEMPTS', undefined, 'code');

    if (!otpMatches(phone, code, otp.codeHash, this.env.SESSION_SECRET)) {
      const attemptsLeft = OTP_POLICY.maxAttempts - (otp.attempts + 1);
      if (attemptsLeft <= 0) throw new DomainError('OTP_TOO_MANY_ATTEMPTS', undefined, 'code');
      throw new DomainError('OTP_INVALID', { attemptsLeft }, 'code');
    }

    const used = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw new DomainError('OTP_INVALID', undefined, 'code');
  }
}
