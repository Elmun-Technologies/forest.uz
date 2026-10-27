import {
  TELEGRAM_LOGIN_POLICY,
  telegramDataCheckString,
  telegramLoginHash,
  verifyTelegramLogin,
} from './telegram-login';

/**
 * Vectors computed independently with Python's hashlib/hmac (the aiogram algorithm):
 *   secret = sha256(token).digest(); hmac.new(secret, "\n".join(sorted(k=v)), sha256).hexdigest()
 */
const TOKEN = '123456789:AAH-test-token_ForestUz0123456789abcd';
const AUTH_DATE = 1761530400;
const PAYLOAD = {
  id: 7512345678,
  first_name: 'Malika',
  last_name: 'Karimova',
  username: 'malika_k',
  photo_url: 'https://t.me/i/userpic/320/abc.jpg',
  auth_date: AUTH_DATE,
  hash: '5b992eccb95bf913eb64bb7860cb844768e11671da3885f7ae3ad97a3f73a3e3',
};

describe('Telegram login widget check', () => {
  it('builds the sorted data-check-string without hash', () => {
    expect(telegramDataCheckString(PAYLOAD)).toBe(
      'auth_date=1761530400\nfirst_name=Malika\nid=7512345678\nlast_name=Karimova\n' +
        'photo_url=https://t.me/i/userpic/320/abc.jpg\nusername=malika_k',
    );
  });

  it('matches the Python vectors (incl. UTF-8 names)', () => {
    expect(telegramLoginHash(telegramDataCheckString(PAYLOAD)!, TOKEN)).toBe(PAYLOAD.hash);
    expect(
      telegramLoginHash(
        telegramDataCheckString({ id: '42', first_name: 'Малика ʻOʼ', auth_date: '1761530400' })!,
        TOKEN,
      ),
    ).toBe('8bb82fc01716f0b61756657ab1ddbf608c67dc977f1857d51e4e9afdba5059c1');
  });

  it('accepts a valid payload and returns the user', () => {
    const r = verifyTelegramLogin(PAYLOAD, TOKEN, AUTH_DATE + 60);
    expect(r).toEqual({
      ok: true,
      user: { id: 7512345678n, username: 'malika_k', firstName: 'Malika', lastName: 'Karimova' },
    });
    // Numbers and strings sign the same way (widget JSON vs. redirect query string).
    const asStrings = Object.fromEntries(Object.entries(PAYLOAD).map(([k, v]) => [k, String(v)]));
    expect(verifyTelegramLogin(asStrings, TOKEN, AUTH_DATE).ok).toBe(true);
  });

  it('rejects a tampered field, another bot token or a bad hash', () => {
    expect(verifyTelegramLogin({ ...PAYLOAD, id: 7512345679 }, TOKEN, AUTH_DATE)).toEqual({
      ok: false,
      reason: 'hash',
    });
    expect(verifyTelegramLogin(PAYLOAD, `${TOKEN}x`, AUTH_DATE)).toMatchObject({ reason: 'hash' });
    expect(verifyTelegramLogin({ ...PAYLOAD, hash: 'zz' }, TOKEN, AUTH_DATE)).toMatchObject({
      reason: 'malformed',
    });
    // An extra (unsigned) field changes the check string.
    expect(verifyTelegramLogin({ ...PAYLOAD, extra: '1' }, TOKEN, AUTH_DATE)).toMatchObject({
      reason: 'hash',
    });
  });

  it('rejects line feeds in values (ambiguous check string)', () => {
    expect(telegramDataCheckString({ first_name: 'a\nid=1' })).toBeNull();
    expect(
      verifyTelegramLogin({ ...PAYLOAD, first_name: 'Malika\nid=1' }, TOKEN, AUTH_DATE),
    ).toMatchObject({ reason: 'malformed' });
  });

  it('rejects stale and future auth_date', () => {
    const max = TELEGRAM_LOGIN_POLICY.maxAgeSec;
    expect(verifyTelegramLogin(PAYLOAD, TOKEN, AUTH_DATE + max).ok).toBe(true);
    expect(verifyTelegramLogin(PAYLOAD, TOKEN, AUTH_DATE + max + 1)).toMatchObject({
      reason: 'expired',
    });
    expect(
      verifyTelegramLogin(PAYLOAD, TOKEN, AUTH_DATE - TELEGRAM_LOGIN_POLICY.futureSkewSec - 1),
    ).toMatchObject({ reason: 'expired' });
  });
});
