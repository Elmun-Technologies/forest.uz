import { CircuitOpenError, HttpClient } from './http-client';

function fetchSeq(responses: (number | Error)[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response('body', {
      status: next ?? 200,
      headers: next === 429 ? { 'retry-after': '1' } : {},
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const sleep = vi.fn(async () => undefined);

describe('HttpClient', () => {
  beforeEach(() => sleep.mockClear());

  it('returns non-transient responses without retry', async () => {
    const f = fetchSeq([404]);
    const c = new HttpClient('x', { fetchImpl: f.impl, sleep });
    const res = await c.request({ method: 'GET', url: 'https://a' });
    expect(res.status).toBe(404);
    expect(f.calls).toHaveLength(1);
  });

  it('retries idempotent requests on 5xx/429/network errors and honours Retry-After', async () => {
    const f = fetchSeq([503, 429, new Error('ECONNRESET'), 200]);
    const c = new HttpClient('x', { fetchImpl: f.impl, sleep, maxRetries: 3 });
    const res = await c.request({ method: 'GET', url: 'https://a' });
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(4);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('never retries non-idempotent POSTs', async () => {
    const f = fetchSeq([503, 200]);
    const c = new HttpClient('x', { fetchImpl: f.impl, sleep });
    await expect(c.request({ method: 'POST', url: 'https://a', body: '{}' })).rejects.toThrow(
      'HTTP 503',
    );
    expect(f.calls).toHaveLength(1);
  });

  it('opens the circuit after repeated failures and closes after cooldown', async () => {
    let now = 0;
    const f = fetchSeq([500, 500, 200]);
    const c = new HttpClient('moysklad', {
      fetchImpl: f.impl,
      sleep,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 1000,
      now: () => now,
    });
    await expect(c.request({ method: 'GET', url: 'https://a' })).rejects.toThrow();
    await expect(c.request({ method: 'GET', url: 'https://a' })).rejects.toThrow();
    await expect(c.request({ method: 'GET', url: 'https://a' })).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    now = 1001;
    expect((await c.request({ method: 'GET', url: 'https://a' })).status).toBe(200);
  });

  it('reports attempts to the observer', async () => {
    const f = fetchSeq([200]);
    const onAttempt = vi.fn();
    await new HttpClient('x', { fetchImpl: f.impl, sleep, onAttempt }).request({
      method: 'GET',
      url: 'https://a',
    });
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: 200, attempt: 1 }));
  });
});
