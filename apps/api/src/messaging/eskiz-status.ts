import type { MessageStatus, Prisma, PrismaClient } from '@forest/db';
import type { Redis } from 'ioredis';

/** Final states are never overwritten (Eskiz may repeat or reorder callbacks). */
const OPEN: MessageStatus[] = ['QUEUED', 'SENT'];

/** A callback may beat our `providerId` write: its final status waits this long in Redis. */
export const ESKIZ_PARK_SECONDS = 600;

export interface EskizFinalStatus {
  outcome: 'DELIVERED' | 'FAILED';
  /** Raw Eskiz status (e.g. DELIVRD, UNDELIV). */
  status: string;
}

const parkKey = (requestId: string) => `eskiz:cb:${requestId}`;

type Db = Pick<PrismaClient | Prisma.TransactionClient, 'message'>;

/** Applies a final status to the open SMS with this Eskiz id; returns the rows changed. */
export async function applyEskizStatus(
  db: Db,
  requestId: string,
  s: EskizFinalStatus,
  now = new Date(),
): Promise<number> {
  const res = await db.message.updateMany({
    where: { channel: 'SMS', providerId: requestId, status: { in: OPEN } },
    data:
      s.outcome === 'DELIVERED'
        ? { status: 'DELIVERED', deliveredAt: now }
        : { status: 'FAILED', error: `eskiz: ${s.status}` },
  });
  return res.count;
}

export async function parkEskizStatus(
  redis: Redis,
  requestId: string,
  s: EskizFinalStatus,
): Promise<void> {
  await redis.set(parkKey(requestId), JSON.stringify(s), 'EX', ESKIZ_PARK_SECONDS);
}

/** Called right after `Message.providerId` is stored: applies a status that arrived first. */
export async function applyParkedEskizStatus(
  redis: Redis,
  db: Db,
  requestId: string,
): Promise<boolean> {
  const raw = await redis.getdel(parkKey(requestId));
  if (!raw) return false;
  const s = JSON.parse(raw) as EskizFinalStatus;
  if (s.outcome !== 'DELIVERED' && s.outcome !== 'FAILED') return false;
  return (await applyEskizStatus(db, requestId, s)) > 0;
}
