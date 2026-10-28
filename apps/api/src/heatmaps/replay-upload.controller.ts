import { Controller, HttpCode, Post, Query, Req } from '@nestjs/common';
import {
  CONSENT_COOKIE,
  DomainError,
  REPLAY_LIMITS,
  type ReplayUploadQuery,
  replayUploadQuerySchema,
} from '@forest/contracts';
import type { Request } from 'express';
import { ZodPipe } from '../common/http';
import { visitorId } from '../common/session';
import { ReplayUploadService } from './replay-upload.service';

/** The tracker's session cookie (packages/tracker, CLAUDE.md §6). */
const TRACKER_SESSION_COOKIE = 'fr_sid';

function cookie(req: Request, name: string): string | null {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && v.length <= 2000 ? v : null;
}

const CHUNK_TYPES = new Set(['application/octet-stream', 'application/gzip']);

/**
 * Reads the raw body: the recorder sends `application/octet-stream` gzip, which no body parser
 * touches. Any other type is refused before reading (a JSON body would already have been
 * consumed by Nest's parser and the stream would never end), and an oversized body is rejected
 * as soon as it crosses the cap — the rest is drained, never buffered.
 */
function readBody(req: Request, limit: number): Promise<Buffer> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!CHUNK_TYPES.has(type)) return Promise.reject(new DomainError('REPLAY_CONTENT_TYPE'));
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.readableEnded) return Promise.reject(new DomainError('REPLAY_CHUNK_INVALID'));
  if (Number(req.headers['content-length'] ?? 0) > limit)
    return Promise.reject(new DomainError('REPLAY_TOO_LARGE'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (c: Buffer) => {
      size += c.length;
      if (size <= limit) return void chunks.push(c);
      stop();
      req.resume(); // drain the rest without keeping it
      reject(new DomainError('REPLAY_TOO_LARGE'));
    };
    const onEnd = () => {
      stop();
      resolve(Buffer.concat(chunks));
    };
    const onError = (e: Error) => {
      stop();
      reject(e);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/** `POST /v1/t/replay` — session replay chunks from `/r.js` (docs/05, CLAUDE.md §6). */
@Controller('t/replay')
export class ReplayUploadController {
  constructor(private readonly replays: ReplayUploadService) {}

  @Post()
  @HttpCode(201)
  async upload(
    @Query(new ZodPipe(replayUploadQuerySchema)) q: ReplayUploadQuery,
    @Req() req: Request,
  ): Promise<{ n: number }> {
    const body = await readBody(req, REPLAY_LIMITS.chunkCompressedBytes);
    const clientNow = Number(req.headers['x-replay-now']);
    return this.replays.accept({
      sid: q.sid,
      reason: q.reason,
      body,
      cookies: {
        sid: cookie(req, TRACKER_SESSION_COOKIE),
        aid: visitorId(req),
        consent: cookie(req, CONSENT_COOKIE),
      },
      ip: req.ip ?? null,
      clientNow: Number.isFinite(clientNow) && clientNow > 0 ? clientNow : null,
    });
  }
}
