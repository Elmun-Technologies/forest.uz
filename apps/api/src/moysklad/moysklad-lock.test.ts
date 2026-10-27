import { MoyskladBusyError, MoyskladLockLostError, withMoyskladLock } from './moysklad-lock';

/** Minimal Redis double for SET NX PX + the release/renew scripts (compare-and-act on the token). */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    store,
    set: vi.fn(async (key: string, value: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    eval: vi.fn(async (script: string, _n: number, key: string, token: string) => {
      if (store.get(key) !== token) return 0;
      if (script.includes('"del"')) store.delete(key);
      return 1;
    }),
  };
  return redis;
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withMoyskladLock', () => {
  it('runs exclusively, releases afterwards and refuses a second holder', async () => {
    const redis = fakeRedis();
    let inner: unknown;
    await withMoyskladLock(redis as never, async () => {
      inner = await withMoyskladLock(redis as never, async () => 'x').catch((e: unknown) => e);
    });
    expect(inner).toBeInstanceOf(MoyskladBusyError);
    expect(redis.store.size).toBe(0);
  });

  it('renews the lease during a long run and aborts at the next write once it is lost', async () => {
    const redis = fakeRedis();
    const result = withMoyskladLock(
      redis as never,
      async (lease) => {
        await tick(30);
        lease.assertHeld(); // renewed: still ours
        redis.store.clear(); // expired / taken over
        await tick(30);
        lease.assertHeld();
        return 'written';
      },
      { renewMs: 10 },
    );
    await expect(result).rejects.toBeInstanceOf(MoyskladLockLostError);
    expect(redis.eval.mock.calls.length).toBeGreaterThan(2);
  });
});
