import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * One Redis lease for all MoySklad sync work (CLAUDE.md §6): catalog pulls, stock snapshots and
 * order hand-overs never interleave across API processes, so a stale stock snapshot can't
 * overwrite a hold that was just handed to MoySklad.
 */
export const MOYSKLAD_LOCK_KEY = 'forest:moysklad:lock';
const TTL_MS = 10 * 60_000;

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

export class MoyskladBusyError extends Error {
  constructor() {
    super('another MoySklad sync is running');
    this.name = 'MoyskladBusyError';
  }
}

export class MoyskladLockLostError extends Error {
  constructor() {
    super('MoySklad lock lost (expired or taken over) — run aborted');
    this.name = 'MoyskladLockLostError';
  }
}

/** Handed to the locked work: call `assertHeld()` before each write. */
export interface MoyskladLease {
  assertHeld(): void;
}

/**
 * Runs `run` under the lease. The lease is renewed every `renewMs` while the work runs; if a
 * renewal finds it gone (Redis restart, a stall longer than the TTL), `assertHeld()` throws so the
 * run stops before its next write instead of interleaving with another holder.
 */
export async function withMoyskladLock<T>(
  redis: Pick<Redis, 'set' | 'eval'>,
  run: (lease: MoyskladLease) => Promise<T>,
  opts: {
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    ttlMs?: number;
    renewMs?: number;
  } = {},
): Promise<T> {
  const token = randomBytes(12).toString('hex');
  const ttl = opts.ttlMs ?? TTL_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    const ok = await redis.set(MOYSKLAD_LOCK_KEY, token, 'PX', ttl, 'NX');
    if (ok === 'OK') break;
    if (Date.now() >= deadline) throw new MoyskladBusyError();
    await sleep(250);
  }
  let lost = false;
  const renew = setInterval(
    () =>
      void redis
        .eval(RENEW, 1, MOYSKLAD_LOCK_KEY, token, String(ttl))
        .then((r) => {
          if (r !== 1) lost = true;
        })
        .catch(() => undefined),
    opts.renewMs ?? Math.floor(ttl / 5),
  );
  renew.unref();
  try {
    return await run({
      assertHeld: () => {
        if (lost) throw new MoyskladLockLostError();
      },
    });
  } finally {
    clearInterval(renew);
    await redis.eval(RELEASE, 1, MOYSKLAD_LOCK_KEY, token).catch(() => undefined);
  }
}
