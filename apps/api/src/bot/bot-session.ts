import type { StorageAdapter } from 'grammy';
import type { RedisService } from '../redis/redis.module';

/** Per-chat flow state (grammY session, Redis `tg:sess:<chatId>`, 7 days). */
export interface BotSession {
  /** Review flow after the stars: waiting for photos, then for the publish consent. */
  review?: { reviewId: string; stage: 'photo' | 'consent'; codeSent: boolean };
  /** The next text is a question for the operator about this topic ("Savolim bor"). */
  ask?: 'cart' | 'advice' | 'other';
}

const TTL_SEC = 7 * 24 * 3600;

/** Minimal grammY storage adapter over the shared ioredis client. */
export function redisSessionStorage(redis: RedisService): StorageAdapter<BotSession> {
  const key = (k: string) => `tg:sess:${k}`;
  return {
    async read(k) {
      const raw = await redis.get(key(k));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as BotSession;
      } catch {
        return undefined;
      }
    },
    async write(k, value) {
      await redis.set(key(k), JSON.stringify(value), 'EX', TTL_SEC);
    },
    async delete(k) {
      await redis.del(key(k));
    },
  };
}
