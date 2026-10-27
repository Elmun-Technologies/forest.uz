import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpAt,
  totpStep,
  verifyTotp,
} from './totp';

/** RFC 4226 / RFC 6238 SHA-1 seed: ASCII "12345678901234567890". */
const SEED = Buffer.from('12345678901234567890', 'ascii');
const SEED_B32 = base32Encode(SEED);

describe('HOTP (RFC 4226 Appendix D)', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  expected.forEach((code, counter) => {
    it(`counter ${counter} → ${code}`, () => expect(hotp(SEED, counter)).toBe(code));
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1, 8 digits)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [t, code] of vectors) {
    it(`T=${t} → ${code}`, () => expect(totpAt(SEED_B32, t * 1000, 8)).toBe(code));
  }
});

describe('base32', () => {
  it('RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1')).toThrow();
  });

  it('generates 160-bit secrets', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
  });
});

describe('verifyTotp', () => {
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  const codeAt = (s: number) => hotp(SEED, s);

  it('accepts the current step and ±1 step of drift', () => {
    expect(verifyTotp(SEED_B32, codeAt(step), now)).toBe(step);
    expect(verifyTotp(SEED_B32, codeAt(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(SEED_B32, codeAt(step + 1), now)).toBe(step + 1);
  });

  it('rejects codes outside the window and malformed input', () => {
    expect(verifyTotp(SEED_B32, codeAt(step - 2), now)).toBeNull();
    expect(verifyTotp(SEED_B32, codeAt(step + 2), now)).toBeNull();
    expect(verifyTotp(SEED_B32, '12345', now)).toBeNull();
    expect(verifyTotp(SEED_B32, 'abcdef', now)).toBeNull();
  });

  it('replay rule: a used step and any older step are refused', () => {
    expect(verifyTotp(SEED_B32, codeAt(step), now, step)).toBeNull();
    expect(verifyTotp(SEED_B32, codeAt(step - 1), now, step)).toBeNull();
    // A newer step than the last accepted one still works (e.g. next 30 s window).
    expect(verifyTotp(SEED_B32, codeAt(step + 1), now, step)).toBe(step + 1);
  });
});

it('otpauth URI', () => {
  const uri = otpauthUri('Forest Admin', 'owner@forest.uz', 'JBSWY3DPEHPK3PXP');
  expect(uri).toBe(
    'otpauth://totp/Forest%20Admin:owner%40forest.uz?secret=JBSWY3DPEHPK3PXP&issuer=Forest%20Admin&algorithm=SHA1&digits=6&period=30',
  );
});
