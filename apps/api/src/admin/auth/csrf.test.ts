import { checkCsrf, isSafeMethod, newCsrfToken } from './csrf';

const adminOrigin = 'https://admin.forest.uz';

describe('admin CSRF (double submit)', () => {
  const token = newCsrfToken();
  const base = {
    method: 'POST',
    header: token,
    cookie: token,
    bound: null,
    origin: undefined,
    adminOrigin,
  };

  it('GET/HEAD/OPTIONS are exempt', () => {
    for (const method of ['GET', 'head', 'OPTIONS'])
      expect(checkCsrf({ ...base, method, header: undefined, cookie: undefined })).toBe('ok');
    expect(isSafeMethod('PATCH')).toBe(false);
  });

  it('accepts matching header and cookie before login', () => {
    expect(checkCsrf(base)).toBe('ok');
  });

  it('requires both header and cookie', () => {
    expect(checkCsrf({ ...base, header: undefined })).toBe('missing');
    expect(checkCsrf({ ...base, cookie: undefined })).toBe('missing');
    expect(checkCsrf({ ...base, header: 'short' })).toBe('missing');
  });

  it('rejects a header that differs from the cookie', () => {
    expect(checkCsrf({ ...base, header: newCsrfToken() })).toBe('mismatch');
  });

  it('with a session the token must be the bound one', () => {
    expect(checkCsrf({ ...base, bound: token })).toBe('ok');
    // Attacker-planted cookie + header pair that isn't the session's token.
    const planted = newCsrfToken();
    expect(checkCsrf({ ...base, header: planted, cookie: planted, bound: token })).toBe('mismatch');
  });

  it('a foreign Origin is refused, a missing one tolerated', () => {
    expect(checkCsrf({ ...base, origin: 'https://forest.uz' })).toBe('bad_origin');
    expect(checkCsrf({ ...base, origin: adminOrigin })).toBe('ok');
  });

  it('tokens are 256-bit url-safe', () => {
    expect(newCsrfToken()).toMatch(/^[\w-]{43}$/);
  });
});
