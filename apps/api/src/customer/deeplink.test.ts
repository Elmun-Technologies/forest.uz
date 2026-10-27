import { DEEPLINK_MAX, signDeepLink, telegramDeepLink, verifyDeepLink } from './deeplink';

const SECRET = 'a'.repeat(64);

describe('deep link tokens', () => {
  it('round-trips and fits Telegram start-parameter rules', () => {
    for (const src of ['popup', 'selector', 'checkout', 'abcdefghijklmnop']) {
      const token = signDeepLink({ kind: 'lead', src }, SECRET);
      expect(token.length).toBeLessThanOrEqual(DEEPLINK_MAX);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(verifyDeepLink(token, SECRET)).toEqual({ kind: 'lead', src });
    }
  });

  it('is deterministic for the same payload and secret', () => {
    const a = signDeepLink({ kind: 'lead', src: 'popup' }, SECRET);
    expect(signDeepLink({ kind: 'lead', src: 'popup' }, SECRET)).toBe(a);
  });

  it('rejects tampered bodies, signatures and foreign secrets', () => {
    const token = signDeepLink({ kind: 'lead', src: 'popup' }, SECRET);
    const forgedBody =
      Buffer.from(JSON.stringify({ k: 'lead', s: 'footer' })).toString('base64url') +
      token.slice(-16);
    expect(verifyDeepLink(forgedBody, SECRET)).toBeNull();
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyDeepLink(flipped, SECRET)).toBeNull();
    expect(verifyDeepLink(token, 'b'.repeat(64))).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyDeepLink('', SECRET)).toBeNull();
    expect(verifyDeepLink('short', SECRET)).toBeNull();
    expect(verifyDeepLink('x'.repeat(65), SECRET)).toBeNull();
    expect(verifyDeepLink('bad token with spaces!!', SECRET)).toBeNull();
    expect(verifyDeepLink('a'.repeat(40), SECRET)).toBeNull();
  });

  it('refuses sources that would break the charset or length budget', () => {
    expect(() => signDeepLink({ kind: 'lead', src: 'Pop Up' }, SECRET)).toThrow(RangeError);
    expect(() => signDeepLink({ kind: 'lead', src: 'x'.repeat(17) }, SECRET)).toThrow(RangeError);
  });

  it('builds t.me links only for valid bot usernames', () => {
    expect(telegramDeepLink('forest_uz_bot', 'tok')).toBe('https://t.me/forest_uz_bot?start=tok');
    expect(telegramDeepLink('@forest_uz_bot', 'tok')).toBe('https://t.me/forest_uz_bot?start=tok');
    expect(telegramDeepLink('', 'tok')).toBeNull();
    expect(telegramDeepLink('bad name', 'tok')).toBeNull();
  });
});
