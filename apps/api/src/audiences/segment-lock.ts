import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const TTL_MS = 15 * 60_000;
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class SegmentBusyError extends Error {
  constructor(segmentId: string) {
    super(`segment ${segmentId} is being refreshed`);
    this.name = 'SegmentBusyError';
  }
}

/**
 * One refresh + destination sync per segment at a time across API processes: two concurrent
 * syncs would both see "no platform audience yet" and create two (the hourly run and a save can
 * overlap).
 */
export async function withSegmentLock<T>(
  redis: Pick<Redis, 'set' | 'eval'>,
  segmentId: string,
  run: () => Promise<T>,
  waitMs: number,
): Promise<T> {
  const key = `forest:audiences:segment:${segmentId}`;
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + waitMs;
  while ((await redis.set(key, token, 'PX', TTL_MS, 'NX')) !== 'OK') {
    if (Date.now() >= deadline) throw new SegmentBusyError(segmentId);
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    return await run();
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
