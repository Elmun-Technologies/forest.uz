import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { TRACK_LIMITS } from '@forest/contracts';
import type { Request, Response } from 'express';
import { assertDevEndpoints } from '../common/dev-endpoints';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { IngestService } from './ingest.service';

/** Express parses `?a=1&a=2` into an array: take one string. */
const firstString = (v: unknown): string | undefined => {
  const first: unknown = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' ? first : undefined;
};

/**
 * Reads the body ourselves: the tracker posts `text/plain` (sendBeacon without a CORS
 * preflight), which Nest's parsers leave unread. Oversized bodies are cut off, never parsed.
 */
async function readBody(req: Request, limit: number): Promise<string | null> {
  if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length)
    return JSON.stringify(req.body);
  if (req.readableEnded) return null;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

@Controller()
export class TrackingController {
  private readonly logger = new Logger('TrackIngest');

  constructor(private readonly ingest: IngestService) {}

  /**
   * Tracker beacon (docs/07). Always 204 and never an error status: the tracker does not retry,
   * and a 4xx would only teach misbehaving clients to loop.
   */
  @Post('t')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async track(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      const body = await readBody(req, TRACK_LIMITS.bodyBytes);
      const outcome = body ? await this.ingest.ingest(req, res, body) : 'oversize';
      if (outcome !== 'stored') this.logger.debug(`batch dropped: ${outcome}`);
    } catch (e) {
      this.logger.error(`ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Dev/e2e: what the ingest stored for a session or visitor (404 outside fake mode). */
@Controller('dev/events')
export class DevEventsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Query('sessionId') rawSid: unknown, @Query('anonymousId') rawAid: unknown) {
    assertDevEndpoints(this.env);
    const sessionId = firstString(rawSid)?.slice(0, 64);
    const anonymousId = firstString(rawAid)?.slice(0, 64);
    if (!sessionId && !anonymousId) return { sessions: [], events: [] };
    const where = sessionId ? { id: sessionId } : { anonymousId: anonymousId! };
    const sessions = await this.prisma.session.findMany({ where, orderBy: { startedAt: 'asc' } });
    const events = await this.prisma.event.findMany({
      where: sessionId ? { sessionId } : { sessionId: { in: sessions.map((s) => s.id) } },
      orderBy: { ts: 'asc' },
      take: 1000,
    });
    const visitor = sessions[0]
      ? await this.prisma.visitor.findUnique({ where: { anonymousId: sessions[0].anonymousId } })
      : null;
    return { sessions, events, visitor };
  }
}
