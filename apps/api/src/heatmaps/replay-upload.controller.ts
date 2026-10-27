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

/**
 * Reads the raw body (the recorder sends `application/octet-stream` gzip, which no body parser
 * touches) with a hard cap; an oversized body is drained, not buffered.
 */
function readBody(req: Request, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) return Promise.reject(new DomainError('REPLAY_TOO_LARGE'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () =>
      size > limit ? reject(new DomainError('REPLAY_TOO_LARGE')) : resolve(Buffer.concat(chunks)),
    );
    req.on('error', reject);
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
