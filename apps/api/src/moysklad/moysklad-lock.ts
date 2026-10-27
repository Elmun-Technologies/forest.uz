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

export class MoyskladBusyError extends Error {
  constructor() {
    super('another MoySklad sync is running');
    this.name = 'MoyskladBusyError';
  }
}

export async function withMoyskladLock<T>(
  redis: Pick<Redis, 'set' | 'eval'>,
  run: () => Promise<T>,
  opts: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const token = randomBytes(12).toString('hex');
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    const ok = await redis.set(MOYSKLAD_LOCK_KEY, token, 'PX', TTL_MS, 'NX');
    if (ok === 'OK') break;
    if (Date.now() >= deadline) throw new MoyskladBusyError();
    await sleep(250);
  }
  try {
    return await run();
  } finally {
    await redis.eval(RELEASE, 1, MOYSKLAD_LOCK_KEY, token).catch(() => undefined);
  }
}
