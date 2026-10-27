import { generateOtpCode, hashOtp, otpMatches } from './otp-code';

const PEPPER = 's'.repeat(64);
const PHONE = '+998901234567';

describe('OTP codes', () => {
  it('generates 4-digit zero-padded codes', () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{4}$/);
  });

  it('hashes with phone and pepper (no plain sha256 of the code)', () => {
    const h = hashOtp(PHONE, '0420', PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('0420');
    expect(hashOtp('+998901234568', '0420', PEPPER)).not.toBe(h);
    expect(hashOtp(PHONE, '0420', 'p'.repeat(64))).not.toBe(h);
  });

  it('matches only the right code for the right phone', () => {
    const h = hashOtp(PHONE, '1234', PEPPER);
    expect(otpMatches(PHONE, '1234', h, PEPPER)).toBe(true);
    expect(otpMatches(PHONE, '1235', h, PEPPER)).toBe(false);
    expect(otpMatches('+998901234568', '1234', h, PEPPER)).toBe(false);
  });

  it('treats malformed stored hashes as a mismatch', () => {
    expect(otpMatches(PHONE, '1234', 'abc', PEPPER)).toBe(false);
    expect(otpMatches(PHONE, '1234', '', PEPPER)).toBe(false);
  });
});
