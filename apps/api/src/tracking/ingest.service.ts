import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ClickIds,
  classifyChannel,
  isCommerceEvent,
  referrerHost,
  scrubPath,
  SESSION_IDLE_MS,
  type TrackEvent,
  trackBatchSchema,
  trackEventSchema,
  type Utm,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import type { Request, Response } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { SessionService } from '../common/session';
import { RateLimiter } from '../customer/common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { isBot } from './bot-filter';
import { GeoIpService } from './geoip';
import { parseUserAgent } from './user-agent';

/** `POST /v1/t` limits (CLAUDE.md §6): mobile carriers put many phones behind one IP. */
export const INGEST_POLICY = { batchesPerIpPerMinute: 600 } as const;
/** Event times are corrected with the batch clock, then clamped to this window. */
const MAX_EVENT_AGE_MS = 3600_000;
export const REALTIME_SESSIONS = 'rt:sessions';
export const realtimeSessionKey = (sessionId: string) => `rt:session:${sessionId}`;

export type IngestOutcome =
  'stored' | 'invalid' | 'bot' | 'rate_limited' | 'foreign_session' | 'empty';

interface Row {
  id: string;
  ts: Date;
  name: string;
  path: string;
  props: Record<string, unknown> | null;
  selector: string | null;
  x: number | null;
  y: number | null;
  viewportW: number | null;
  scrollDepth: number | null;
}

/** Acquisition context of a session = the visitor's touch (Visitor/Customer first/last touch). */
export interface Touch {
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  clickId: string | null;
  referrer: string | null;
  landing: string;
  ts: string;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Tracker ingest (docs/07 "Ingest pipeline"): validate → drop bots → enrich (UA, GeoIP, channel)
 * → insert Event rows → upsert Session aggregates and the Visitor → realtime Redis keys. Every
 * failure path is silent for the browser (the controller always answers 204).
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('TrackIngest');
  private readonly ownHosts: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly geo: GeoIpService,
    @Inject(ENV) env: Env,
  ) {
    this.ownHosts = [new URL(env.APP_URL).hostname, 'localhost'];
  }

  async ingest(
    req: Request,
    res: Response,
    body: string,
    serverNow = Date.now(),
  ): Promise<IngestOutcome> {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return 'invalid';
    }
    const batch = trackBatchSchema.safeParse(json);
    if (!batch.success) return 'invalid';
    const ua = req.header('user-agent') ?? '';
    if (isBot({ userAgent: ua, webdriver: batch.data.wd })) return 'bot';
    const limit = await this.limiter.hit(
      'trk:ip',
      req.ip ?? 'unknown',
      INGEST_POLICY.batchesPerIpPerMinute,
      60,
    );
    if (!limit.ok) return 'rate_limited';

    const skew = serverNow - batch.data.now;
    const rows: Row[] = [];
    for (const raw of batch.data.events) {
      const parsed = trackEventSchema.safeParse(raw);
      if (parsed.success) rows.push(this.row(parsed.data, skew, serverNow));
    }
    if (!rows.length) return 'empty';
    rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    const anonymousId = this.sessions.ensureVisitorId(req, res);
    const sid = batch.data.sid;
    const [login, visitor] = await Promise.all([
      this.sessions.read(req).catch(() => null),
      this.prisma.visitor.findUnique({ where: { anonymousId }, select: { customerId: true } }),
    ]);
    const customerId = login?.customerId ?? visitor?.customerId ?? null;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;

    // A new session freezes its acquisition context from its landing page_view.
    const landing = rows.find((r) => r.name === 'page_view') ?? first;
    const lp = (landing.name === 'page_view' ? landing.props : null) ?? {};
    const utm = (lp.utm as Utm | undefined) ?? null;
    const clickIds = (lp.clickIds as ClickIds | undefined) ?? null;
    const referrer = str(lp.referrer);
    const channel = classifyChannel({ utm, clickIds, referrer, ownHosts: this.ownHosts });
    const device = parseUserAgent(ua);
    const created = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "Session" ("id", "anonymousId", "customerId", "startedAt", "endedAt", "landingPath",
        "utm", "clickIds", "referrer", "channel", "device", "os", "browser")
      VALUES (${sid}, ${anonymousId}, ${customerId}, ${first.ts}, ${first.ts}, ${landing.path},
        ${utm ? JSON.stringify(utm) : null}::jsonb, ${clickIds ? JSON.stringify(clickIds) : null}::jsonb,
        ${referrer}, ${channel}, ${device.device}, ${device.os}, ${device.browser})
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"`;
    const isNew = created.length > 0;
    if (isNew) {
      const geo = this.geo.lookup(req.ip);
      if (geo)
        await this.prisma.session.update({
          where: { id: sid },
          data: { city: geo.city, region: geo.region, country: geo.country },
        });
    }

    const pageviews = rows.filter((r) => r.name === 'page_view');
    const engaged = rows.some((r) => isCommerceEvent(r.name));
    const exitPath = (pageviews[pageviews.length - 1] ?? last).path;
    const updated = await this.prisma.$queryRaw<
      { channel: string; device: string; region: string | null }[]
    >`
      UPDATE "Session" SET
        "pageviews" = "pageviews" + ${pageviews.length},
        "events" = "events" + ${rows.length},
        "startedAt" = LEAST("startedAt", ${first.ts}),
        "endedAt" = GREATEST("endedAt", ${last.ts}),
        "durationSec" = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST("endedAt", ${last.ts}) - LEAST("startedAt", ${first.ts})))::int),
        "exitPath" = CASE WHEN ${last.ts} >= "endedAt" THEN ${exitPath} ELSE "exitPath" END,
        "bounced" = "bounced" AND NOT ${engaged} AND ("pageviews" + ${pageviews.length}) <= 1,
        "customerId" = COALESCE("customerId", ${customerId})
      WHERE "id" = ${sid} AND "anonymousId" = ${anonymousId}
      RETURNING "channel", "device", "region"`;
    const session = updated[0];
    // The id belongs to another visitor (copied cookie, replay): never mix two visitors' events.
    if (!session) return 'foreign_session';

    const values = rows.map(
      (r) =>
        Prisma.sql`(${r.id}, ${r.ts}, ${sid}, ${anonymousId}, ${customerId}, ${r.name}, ${r.path},
          ${r.props ? JSON.stringify(r.props) : null}::jsonb, ${r.selector}, ${r.x}::int, ${r.y}::int,
          ${r.viewportW}::int, ${r.scrollDepth}::int)`,
    );
    await this.prisma.$executeRaw`
      INSERT INTO "Event" ("id", "ts", "sessionId", "anonymousId", "customerId", "name", "path",
        "props", "selector", "x", "y", "viewportW", "scrollDepth")
      VALUES ${Prisma.join(values)}
      ON CONFLICT DO NOTHING`;

    await this.touchVisitor(
      anonymousId,
      isNew ? touch(channel, utm, clickIds, referrer, landing) : null,
      last.ts,
    );
    await this.realtime(sid, exitPath, session, serverNow);
    return 'stored';
  }

  private row(e: TrackEvent, skew: number, serverNow: number): Row {
    const t = Math.min(serverNow, Math.max(serverNow - MAX_EVENT_AGE_MS, e.t + skew));
    const props = e.props && Object.keys(e.props).length ? e.props : null;
    return {
      id: e.id,
      ts: new Date(t),
      name: e.name,
      path: scrubPath(e.path),
      props,
      selector: e.selector ?? null,
      x: e.x ?? null,
      y: e.y ?? null,
      viewportW: e.viewportW ?? null,
      scrollDepth: e.scrollDepth ?? null,
    };
  }

  private async touchVisitor(anonymousId: string, t: Touch | null, at: Date): Promise<void> {
    const json = t ? JSON.stringify(t) : null;
    await this.prisma.$executeRaw`
      INSERT INTO "Visitor" ("anonymousId", "firstSeenAt", "lastSeenAt", "firstTouch", "lastTouch")
      VALUES (${anonymousId}, ${at}, ${at}, ${json}::jsonb, ${json}::jsonb)
      ON CONFLICT ("anonymousId") DO UPDATE SET
        "lastSeenAt" = GREATEST("Visitor"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "firstTouch" = COALESCE("Visitor"."firstTouch", EXCLUDED."firstTouch"),
        "lastTouch" = COALESCE(EXCLUDED."lastTouch", "Visitor"."lastTouch")`;
  }

  /** "Hozir saytda" (agent 2 reads): sessions seen in the last 30 min + their current page. */
  private async realtime(
    sid: string,
    path: string,
    s: { channel: string; device: string; region: string | null },
    now: number,
  ): Promise<void> {
    try {
      await this.redis
        .multi()
        .zadd(REALTIME_SESSIONS, now, sid)
        .zremrangebyscore(REALTIME_SESSIONS, '-inf', now - SESSION_IDLE_MS)
        .hset(realtimeSessionKey(sid), {
          path,
          channel: s.channel,
          device: s.device,
          region: s.region ?? '',
        })
        .expire(realtimeSessionKey(sid), SESSION_IDLE_MS / 1000)
        .exec();
    } catch (e) {
      this.logger.warn(`realtime write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function touch(
  channel: string,
  utm: Utm | null,
  clickIds: ClickIds | null,
  referrer: string | null,
  landing: Row,
): Touch {
  const clickKey = clickIds ? (Object.keys(clickIds) as (keyof ClickIds)[])[0] : undefined;
  return {
    channel,
    source: utm?.source ?? referrerHost(referrer) ?? (channel === 'direct' ? 'direct' : null),
    medium: utm?.medium ?? (referrer ? 'referral' : null),
    campaign: utm?.campaign ?? null,
    content: utm?.content ?? null,
    term: utm?.term ?? null,
    clickId: clickKey ? `${clickKey}:${clickIds![clickKey]}` : null,
    referrer,
    landing: landing.path,
    ts: landing.ts.toISOString(),
  };
}
