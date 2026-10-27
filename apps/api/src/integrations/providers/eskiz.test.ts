import { HttpClient } from '../http-client';
import {
  ESKIZ_TOKEN_POLICY,
  EskizSmsProvider,
  EskizTokenCache,
  eskizCallbackTokenMatches,
  eskizOutcome,
  eskizPhone,
  eskizTokenTtlMs,
  jwtExpiryMs,
  parseEskizCallback,
  type TokenKv,
} from './eskiz';

/** In-memory TokenKv with PX expiry on a controllable clock. */
function memoryKv(
  now: () => number,
): TokenKv & { data: Map<string, { v: string; until: number }> } {
  const data = new Map<string, { v: string; until: number }>();
  const live = (k: string) => {
    const e = data.get(k);
    if (e && e.until <= now()) data.delete(k);
    return data.get(k);
  };
  return {
    data,
    get: async (k) => live(k)?.v ?? null,
    setPx: async (k, v, ms) => void data.set(k, { v, until: now() + ms }),
    setNxPx: async (k, v, ms) => {
      if (live(k)) return false;
      data.set(k, { v, until: now() + ms });
      return true;
    },
    del: async (k) => void data.delete(k),
  };
}

const jwt = (expSec: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;

describe('Eskiz helpers', () => {
  it('formats phones as 998XXXXXXXXX digits', () => {
    expect(eskizPhone('+998901234567')).toBe('998901234567');
    expect(eskizPhone('998 90 123-45-67')).toBe('998901234567');
    expect(() => eskizPhone('+79001234567')).toThrow();
    expect(() => eskizPhone('+99890123456')).toThrow();
  });

  it('maps delivery statuses (final vs pending)', () => {
    expect(eskizOutcome('DELIVRD')).toBe('DELIVERED');
    expect(eskizOutcome('delivered')).toBe('DELIVERED');
    for (const s of ['UNDELIV', 'EXPIRED', 'REJECTD', 'REJECTED', 'DELETED'])
      expect(eskizOutcome(s)).toBe('FAILED');
    for (const s of ['NEW', 'STORED', 'ACCEPTED', 'ENROUTE', 'UNKNOWN', 'waiting'])
      expect(eskizOutcome(s)).toBe('PENDING');
  });

  it('parses callbacks and rejects junk', () => {
    expect(
      parseEskizCallback({
        request_id: 'b169553b-de29-4649-b5dd-cfafd85984f9',
        message_id: '4385062',
        phone_number: '998991234567',
        status: 'DELIVRD',
        status_date: '2021-04-02 00:39:36',
      }),
    ).toEqual({
      requestId: 'b169553b-de29-4649-b5dd-cfafd85984f9',
      status: 'DELIVRD',
      outcome: 'DELIVERED',
      statusDate: '2021-04-02 00:39:36',
    });
    expect(parseEskizCallback({ status: 'DELIVRD' })).toBeNull();
    expect(parseEskizCallback({ request_id: "x'; drop", status: 'DELIVRD' })).toBeNull();
    expect(parseEskizCallback('nope')).toBeNull();
  });

  it('compares callback tokens in constant time and never matches a missing one', () => {
    expect(eskizCallbackTokenMatches('abc', 'abc')).toBe(true);
    expect(eskizCallbackTokenMatches('abd', 'abc')).toBe(false);
    expect(eskizCallbackTokenMatches('', undefined)).toBe(false);
  });

  it('caches a token until an hour before its JWT exp (fallback 24 h)', () => {
    const now = 1_000_000_000_000;
    expect(jwtExpiryMs(jwt(now / 1000 + 30 * 86400))).toBe(now + 30 * 86400_000);
    expect(eskizTokenTtlMs(jwt(now / 1000 + 30 * 86400), now)).toBe(
      30 * 86400_000 - ESKIZ_TOKEN_POLICY.renewBeforeMs,
    );
    expect(eskizTokenTtlMs('opaque-token', now)).toBe(
      ESKIZ_TOKEN_POLICY.fallbackTtlMs - ESKIZ_TOKEN_POLICY.renewBeforeMs,
    );
    // Already (almost) expired: still cached briefly rather than logging in on every send.
    expect(eskizTokenTtlMs(jwt(now / 1000 + 60), now)).toBe(ESKIZ_TOKEN_POLICY.minTtlMs);
  });
});

describe('EskizTokenCache', () => {
  it('single-flights concurrent logins and serves the cache afterwards', async () => {
    let clock = 0;
    const kv = memoryKv(() => clock);
    const cache = new EskizTokenCache(kv, { now: () => clock });
    let logins = 0;
    const login = async () => {
      logins++;
      await new Promise((r) => setTimeout(r, 5));
      return `tok-${logins}`;
    };
    const tokens = await Promise.all(Array.from({ length: 10 }, () => cache.get('k', login)));
    expect(new Set(tokens)).toEqual(new Set(['tok-1']));
    expect(logins).toBe(1);
    expect(await cache.get('k', login)).toBe('tok-1');
    // Expiry (fallback TTL) → next call logs in again.
    clock += ESKIZ_TOKEN_POLICY.fallbackTtlMs;
    expect(await cache.get('k', login)).toBe('tok-2');
  });

  it('waits for another process holding the login lock instead of logging in too', async () => {
    const kv = memoryKv(() => 0);
    await kv.setNxPx('k:lock', '1', 10_000);
    let slept = 0;
    const cache = new EskizTokenCache(kv, {
      sleep: async () => {
        slept++;
        if (slept === 3) await kv.setPx('k', 'from-other-process', 60_000);
      },
    });
    let logins = 0;
    expect(await cache.get('k', async () => `own-${++logins}`)).toBe('from-other-process');
    expect(logins).toBe(0);
  });

  it('invalidates only the token that failed', async () => {
    const kv = memoryKv(() => 0);
    const cache = new EskizTokenCache(kv);
    await cache.put('k', 'new');
    await cache.invalidate('k', 'old');
    expect(await kv.get('k')).toBe('new');
    await cache.invalidate('k', 'new');
    expect(await kv.get('k')).toBeNull();
  });
});

describe('EskizSmsProvider (fake HTTP)', () => {
  function setup(responses: ((url: string, init: RequestInit) => Response)[]) {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, auth: headers.get('authorization'), body: String(init.body ?? '') });
      const next = responses.shift();
      if (!next) throw new Error('unexpected call');
      return next(url, init);
    }) as unknown as typeof fetch;
    const kv = memoryKv(() => Date.now());
    const provider = new EskizSmsProvider(
      { email: 'shop@forest.uz', password: 'secret-key', from: '4546' },
      {
        http: new HttpClient('eskiz', { fetchImpl, sleep: async () => undefined }),
        tokens: new EskizTokenCache(kv),
        apiUrl: 'https://eskiz.test/api/',
        callbackUrl: 'https://api.forest.test/v1/webhooks/eskiz/cb-token',
      },
    );
    return { provider, calls, kv };
  }
  const json = (status: number, body: unknown) => () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const loginOk = (token: string) =>
    json(200, { message: 'token_generated', data: { token }, token_type: 'bearer' });

  it('logs in, sends form fields and maps the request id', async () => {
    const { provider, calls } = setup([
      loginOk('T1'),
      json(200, { id: 'uuid-1', message: 'Waiting for SMS provider', status: 'waiting' }),
      json(200, { id: 'uuid-2', status: 'waiting' }),
    ]);
    const r = await provider.send({
      phone: '+998901234567',
      text: 'Forest: kod 1234',
      templateKey: 'otp',
    });
    expect(r).toEqual({ providerId: 'uuid-1' });
    expect(calls[0]!.url).toBe('https://eskiz.test/api/auth/login');
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      email: 'shop@forest.uz',
      password: 'secret-key',
    });
    expect(calls[1]!.url).toBe('https://eskiz.test/api/message/sms/send');
    expect(calls[1]!.auth).toBe('Bearer T1');
    expect(Object.fromEntries(new URLSearchParams(calls[1]!.body))).toEqual({
      mobile_phone: '998901234567',
      message: 'Forest: kod 1234',
      from: '4546',
      callback_url: 'https://api.forest.test/v1/webhooks/eskiz/cb-token',
    });
    // Cached token: no second login.
    await provider.send({ phone: '+998901234567', text: 'x', templateKey: 'otp' });
    expect(calls.map((c) => c.url.split('/api')[1])).toEqual([
      '/auth/login',
      '/message/sms/send',
      '/message/sms/send',
    ]);
  });

  it('re-logs in once on 401, then gives up', async () => {
    const { provider, calls } = setup([
      loginOk('T1'),
      json(401, { message: 'Expired', status: 'token-expired' }),
      loginOk('T2'),
      json(200, { id: 'uuid-3', status: 'waiting' }),
    ]);
    expect(await provider.send({ phone: '+998901234567', text: 'x', templateKey: 't' })).toEqual({
      providerId: 'uuid-3',
    });
    expect(calls[3]!.auth).toBe('Bearer T2');

    const again = setup([loginOk('A'), json(401, {}), loginOk('B'), json(401, {})]);
    await expect(
      again.provider.send({ phone: '+998901234567', text: 'x', templateKey: 't' }),
    ).rejects.toThrow(/HTTP 401/);
    expect(again.calls).toHaveLength(4);
  });

  it('does not retry a send on 5xx (it may have gone out) and masks phones in errors', async () => {
    const { provider, calls } = setup([
      loginOk('T1'),
      json(500, { message: 'failed for 998901234567' }),
    ]);
    const err = await provider
      .send({ phone: '+998901234567', text: 'x', templateKey: 't' })
      .catch((e: Error) => e);
    expect(String(err)).not.toContain('901234567');
    expect(calls).toHaveLength(2);
  });

  it('health check = login', async () => {
    expect(await setup([loginOk('T')]).provider.test()).toEqual({ ok: true, message: 'login ok' });
    const bad = await setup([json(401, { message: 'Invalid credentials' })]).provider.test();
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('Invalid credentials');
  });
});
