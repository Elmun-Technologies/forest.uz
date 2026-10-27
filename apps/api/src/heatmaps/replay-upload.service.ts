import { isIPv6 } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import {
  DomainError,
  parseConsent,
  REPLAY_LIMITS,
  type ReplayReason,
  replayPrefix,
  replaySampled,
  scrubReplayEvent,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { RateLimiter } from '../customer/common/rate-limit';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { tashkentDay } from './heatmap-days';

export interface ReplayUploadInput {
  sid: string;
  reason: ReplayReason;
  /** Raw request body (gzip). */
  body: Buffer;
  cookies: { sid: string | null; aid: string | null; consent: string | null };
  ip: string | null;
  /** The recorder's `Date.now()` at send time (clock skew of its timestamps). */
  clientNow: number | null;
}

const counterKey = (sid: string) => `replay:session:${sid}`;
const dailyKey = (day: string) => `replay:bytes:${day}`;

/**
 * Rate-limit identity of a client address: IPv4 as is, IPv6 by its /64 (one subscriber usually
 * holds a whole /64, so per-address limits would be trivial to dodge).
 */
export function ipBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
/** Counters outlive any session (30 min idle) with margin. */
const COUNTER_TTL_SEC = 2 * 86_400;

/**
 * `POST /v1/t/replay`: stores one gzip chunk of rrweb events for a consented, sampled session
 * (CLAUDE.md §6). Every check runs before anything is written; the body is stored as received.
 */
@Injectable()
export class ReplayUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly limiter: RateLimiter,
  ) {}

  async accept(input: ReplayUploadInput, now = new Date()): Promise<{ n: number }> {
    const rules = await this.settings.get('tracking.rules');
    if (!rules.replayEnabled) throw new DomainError('REPLAY_NOT_ALLOWED');
    // Recording consent, and analytics not refused (CLAUDE.md §6 replay gate).
    const consent = parseConsent(input.cookies.consent);
    if (consent?.replay !== true || consent.analytics === false)
      throw new DomainError('REPLAY_NOT_ALLOWED');
    if (input.cookies.sid !== input.sid) throw new DomainError('REPLAY_NOT_ALLOWED');
    const pct = input.reason === 'checkout' ? rules.replayCheckoutPct : rules.replaySamplePct;
    if (!replaySampled(input.sid, pct)) throw new DomainError('REPLAY_NOT_ALLOWED');

    await this.limiter.consume(
      'replay:sid',
      input.sid,
      REPLAY_LIMITS.chunksPerMinutePerSession,
      60,
    );
    if (input.ip)
      await this.limiter.consume(
        'replay:ip',
        ipBucket(input.ip),
        REPLAY_LIMITS.chunksPerMinutePerIp,
        60,
      );

    // What is stored is our own re-serialisation: validated, URL-scrubbed, re-compressed.
    const events = parseChunk(input.body).map((e) => scrubReplayEvent(e));
    const body = gzipSync(Buffer.from(JSON.stringify(events)));

    const session = await this.prisma.session.findUnique({
      where: { id: input.sid },
      select: { anonymousId: true, startedAt: true, hasReplay: true, replayKey: true },
    });
    // Ingest may not have written the session yet: the recorder keeps the chunk and retries.
    if (!session) throw new DomainError('REPLAY_SESSION_UNKNOWN');
    if (!input.cookies.aid || session.anonymousId !== input.cookies.aid)
      throw new DomainError('REPLAY_NOT_ALLOWED');

    const key = counterKey(input.sid);
    // `checkout` is only believed once the session's checkout page view is stored.
    if (input.reason === 'checkout' && (await this.redis.hget(key, 'checkout')) !== '1') {
      if (!(await this.reachedCheckout(input.sid, session.startedAt, now)))
        throw new DomainError('REPLAY_SESSION_UNKNOWN');
      await this.redis.multi().hset(key, 'checkout', '1').expire(key, COUNTER_TTL_SEC).exec();
    }

    const day = tashkentDay(now);
    const res = await this.redis
      .multi()
      .hincrby(key, 'n', 1)
      .hincrby(key, 'bytes', body.length)
      .expire(key, COUNTER_TTL_SEC)
      .incrby(dailyKey(day), body.length)
      .expire(dailyKey(day), 2 * 86_400)
      .exec();
    const n = Number(res?.[0]?.[1] ?? 0);
    const bytes = Number(res?.[1]?.[1] ?? 0);
    const today = Number(res?.[3]?.[1] ?? 0);
    if (
      n > REPLAY_LIMITS.chunksPerSession ||
      bytes > REPLAY_LIMITS.sessionCompressedBytes ||
      today > REPLAY_LIMITS.dailyCompressedBytes
    )
      throw new DomainError('REPLAY_TOO_LARGE');

    const prefix = session.replayKey ?? replayPrefix(tashkentDay(session.startedAt), input.sid);
    const skew = input.clientNow === null ? 0 : now.getTime() - input.clientNow;
    await this.files.putPrivate(
      `${prefix}${String(n).padStart(5, '0')}.json.gz`,
      body,
      'application/gzip',
      { skew: String(Math.round(skew)), reason: input.reason },
    );
    if (!session.hasReplay)
      await this.prisma.session.updateMany({
        where: { id: input.sid, hasReplay: false },
        data: { hasReplay: true, replayKey: prefix },
      });
    return { n };
  }

  /** A stored `page_view` of `/checkout` (either locale) in this session (ts-bounded). */
  private async reachedCheckout(sid: string, startedAt: Date, now: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>(Prisma.sql`
      SELECT 1 AS ok FROM "Event"
      WHERE "sessionId" = ${sid} AND name = 'page_view'
        AND ts >= ${new Date(startedAt.getTime() - 60_000)} AND ts <= ${new Date(now.getTime() + 60_000)}
        AND path ~ '^/(uz/|ru/)?checkout(/|$)'
      LIMIT 1`);
    return rows.length > 0;
  }
}

/** Gzip of a non-empty JSON array of rrweb events within the size caps → the events. */
export function parseChunk(body: Buffer): object[] {
  if (body.length === 0 || body.length > REPLAY_LIMITS.chunkCompressedBytes)
    throw new DomainError(body.length === 0 ? 'REPLAY_CHUNK_INVALID' : 'REPLAY_TOO_LARGE');
  if (body[0] !== 0x1f || body[1] !== 0x8b) throw new DomainError('REPLAY_CHUNK_INVALID');
  let raw: Buffer;
  try {
    raw = gunzipSync(body, { maxOutputLength: REPLAY_LIMITS.chunkDecompressedBytes });
  } catch (e) {
    const tooBig =
      e instanceof RangeError || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
    throw new DomainError(tooBig ? 'REPLAY_TOO_LARGE' : 'REPLAY_CHUNK_INVALID');
  }
  let events: unknown;
  try {
    events = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new DomainError('REPLAY_CHUNK_INVALID');
  }
  if (!Array.isArray(events) || events.length === 0) throw new DomainError('REPLAY_CHUNK_INVALID');
  for (const e of events) {
    const ev = e as { type?: unknown; timestamp?: unknown } | null;
    if (
      !ev ||
      typeof ev !== 'object' ||
      !Number.isInteger(ev.type) ||
      (ev.type as number) < 0 ||
      (ev.type as number) > 10 ||
      typeof ev.timestamp !== 'number' ||
      !Number.isFinite(ev.timestamp)
    )
      throw new DomainError('REPLAY_CHUNK_INVALID');
  }
  return events as object[];
}
