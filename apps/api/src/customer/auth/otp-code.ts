import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** OTP policy (docs/05, docs/14). */
export const OTP_POLICY = {
  ttlSec: 5 * 60,
  maxAttempts: 5,
  resendSec: 60,
  sendsPerIpPerHour: 5,
  sendsPerPhonePerHour: 5,
  sendsPerPhonePerDay: 10,
  /** 4-digit codes: 15 wrong guesses a day per phone, then the phone is locked for the day. */
  failedVerifiesPerPhonePerDay: 15,
} as const;

export function generateOtpCode(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

/**
 * 4-digit codes have only 10⁴ values, so a plain hash is trivially reversible: binding the
 * phone and a server-side pepper (SESSION_SECRET) makes a leaked OtpCode table useless.
 */
export function hashOtp(phone: string, code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`otp:${phone}:${code}`).digest('hex');
}

export function otpMatches(
  phone: string,
  code: string,
  storedHash: string,
  pepper: string,
): boolean {
  const expected = Buffer.from(hashOtp(phone, code, pepper), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}
