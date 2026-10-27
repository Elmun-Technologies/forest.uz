import { gunzipSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import {
  DomainError,
  parseConsent,
  REPLAY_LIMITS,
  type ReplayReason,
  replayPrefix,
  replaySampled,
} from '@forest/contracts';
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
    if (parseConsent(input.cookies.consent)?.replay !== true)
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
      await this.limiter.consume('replay:ip', input.ip, REPLAY_LIMITS.chunksPerMinutePerIp, 60);

    validateChunk(input.body);

    const session = await this.prisma.session.findUnique({
      where: { id: input.sid },
      select: { anonymousId: true, startedAt: true, hasReplay: true, replayKey: true },
    });
    // Ingest may not have written the session yet: the recorder keeps the chunk and retries.
    if (!session) throw new DomainError('REPLAY_SESSION_UNKNOWN');
    if (!input.cookies.aid || session.anonymousId !== input.cookies.aid)
      throw new DomainError('REPLAY_NOT_ALLOWED');

    const key = counterKey(input.sid);
    const res = await this.redis
      .multi()
      .hincrby(key, 'n', 1)
      .hincrby(key, 'bytes', input.body.length)
      .expire(key, COUNTER_TTL_SEC)
      .exec();
    const n = Number(res?.[0]?.[1] ?? 0);
    const bytes = Number(res?.[1]?.[1] ?? 0);
    if (n > REPLAY_LIMITS.chunksPerSession || bytes > REPLAY_LIMITS.sessionCompressedBytes)
      throw new DomainError('REPLAY_TOO_LARGE');

    const prefix = session.replayKey ?? replayPrefix(tashkentDay(session.startedAt), input.sid);
    const skew = input.clientNow === null ? 0 : now.getTime() - input.clientNow;
    await this.files.putPrivate(
      `${prefix}${String(n).padStart(5, '0')}.json.gz`,
      input.body,
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
}

/** Gzip of a non-empty JSON array of rrweb events within the size caps. */
export function validateChunk(body: Buffer): void {
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
}
