import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import {
  DomainError,
  hasPermission,
  maskUzPhone,
  normalizeHeatmapPath,
  REPLAY_FILTERS,
  REPLAY_LIMITS,
  type ReplayFilter,
  type ReplayListDto,
  type ReplayListQuery,
  type ReplayMarkerDto,
  type ReplayMarkerKind,
  type ReplayOpenDto,
  type ReplayOutcome,
  type ReplaySessionDto,
  type StaffRole,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { FilesService } from '../../files/files.service';
import { NORMALIZED_PATH } from '../../heatmaps/heatmap-aggregator.service';
import { lastDays } from '../../heatmaps/heatmap-days';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

interface Row {
  id: string;
  startedAt: Date;
  durationSec: number;
  device: string;
  channel: string;
  region: string | null;
  anonymousId: string;
  customerId: string | null;
  purchased: boolean;
  cart: boolean;
  rage: number;
  lead: boolean;
}

const MAX_TRAIL = 8;
const MAX_MARKERS = 500;
/** Event window around a session (client timestamps vs session bounds). */
const PAD = Prisma.sql`interval '2 minutes'`;

/** Session flags from its events; the subquery bounds `ts` so Event partitions are pruned. */
const FLAGS = Prisma.sql`
  (s.converted OR s."orderId" IS NOT NULL) AS purchased,
  EXISTS (SELECT 1 FROM "Event" e WHERE e."sessionId" = s.id AND e.name = 'add_to_cart'
          AND e.ts BETWEEN s."startedAt" - ${PAD} AND s."endedAt" + ${PAD}) AS cart,
  (SELECT count(*)::int FROM "Event" e WHERE e."sessionId" = s.id AND e.name = 'rage_click'
          AND e.ts BETWEEN s."startedAt" - ${PAD} AND s."endedAt" + ${PAD}) AS rage,
  EXISTS (SELECT 1 FROM "Event" e WHERE e."sessionId" = s.id AND e.name = 'lead'
          AND e.ts BETWEEN s."startedAt" - ${PAD} AND s."endedAt" + ${PAD}) AS lead`;

const FILTER_SQL: Record<ReplayFilter, Prisma.Sql> = {
  purchased: Prisma.sql`purchased`,
  abandoned: Prisma.sql`(cart AND NOT purchased)`,
  rage: Prisma.sql`rage > 0`,
  lead: Prisma.sql`lead`,
};

function outcome(r: Row): ReplayOutcome {
  if (r.purchased) return 'purchased';
  if (r.cart) return 'abandoned';
  if (r.lead) return 'lead';
  if (r.rage > 0) return 'rage';
  return 'exited';
}

const encodeCursor = (r: { startedAt: Date; id: string }) =>
  Buffer.from(`${r.startedAt.toISOString()}|${r.id}`).toString('base64url');

function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const startedAt = new Date(ts ?? '');
  return id && !Number.isNaN(startedAt.getTime()) ? { startedAt, id } : null;
}

/** "Dilnoza Rahimova" → "Dilnoza R." */
function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : (first ?? '');
}

const MARKER_KIND: Record<string, ReplayMarkerKind> = {
  page_view: 'page',
  click: 'click',
  js_error: 'error',
  form_error: 'error',
  promo_rejected: 'error',
  exit: 'exit',
  rage_click: 'rage',
  add_to_cart: 'goal',
  begin_checkout: 'goal',
  add_payment_info: 'goal',
  purchase: 'goal',
  lead: 'goal',
};

/**
 * A3 session recordings: the list (sessions with `hasReplay`, outcome chips) and opening one
 * (`session.view_replay` audit, then the rrweb events from object storage + event markers).
 */
@Injectable()
export class AdminReplaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private base(q: Pick<ReplayListQuery, 'days' | 'device' | 'path'>, now: Date): Prisma.Sql {
    const since = lastDays(q.days, now)[0]!.start;
    const parts: Prisma.Sql[] = [
      Prisma.sql`s."hasReplay" AND s."replayKey" IS NOT NULL AND s."startedAt" >= ${since}`,
    ];
    if (q.device === 'mobile') parts.push(Prisma.sql`s.device = 'mobile'`);
    if (q.device === 'desktop') parts.push(Prisma.sql`s.device <> 'mobile'`);
    if (q.path)
      parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Event" e WHERE e."sessionId" = s.id
        AND e.name = 'page_view' AND e.ts BETWEEN s."startedAt" - ${PAD} AND s."endedAt" + ${PAD}
        AND ${NORMALIZED_PATH(Prisma.sql`e.path`)} = ${q.path})`);
    return Prisma.join(parts, ' AND ');
  }

  async list(q: ReplayListQuery, role: StaffRole, now = new Date()): Promise<ReplayListDto> {
    const where = this.base(q, now);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const conds: Prisma.Sql[] = [];
    if (q.filter) conds.push(FILTER_SQL[q.filter]);
    if (cursor)
      conds.push(Prisma.sql`("startedAt", id) < (${cursor.startedAt}::timestamptz, ${cursor.id})`);
    const outer = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT * FROM (
          SELECT s.id, s."startedAt", s."durationSec", s.device, s.channel, s.region,
                 s."anonymousId", s."customerId", ${FLAGS}
          FROM "Session" s WHERE ${where}
        ) t ${outer}
        ORDER BY "startedAt" DESC, id DESC
        LIMIT ${q.limit + 1}`,
      this.prisma.$queryRaw<Record<ReplayFilter | 'all', number>[]>`
        SELECT count(*)::int AS "all",
               count(*) FILTER (WHERE ${FILTER_SQL.abandoned})::int AS abandoned,
               count(*) FILTER (WHERE ${FILTER_SQL.purchased})::int AS purchased,
               count(*) FILTER (WHERE ${FILTER_SQL.rage})::int AS rage,
               count(*) FILTER (WHERE ${FILTER_SQL.lead})::int AS lead
        FROM (SELECT ${FLAGS} FROM "Session" s WHERE ${where}) t`,
    ]);
    const page = rows.slice(0, q.limit);
    const c = countRows[0];
    return {
      items: await this.toDtos(page, role),
      nextCursor: rows.length > q.limit && page.length ? encodeCursor(page.at(-1)!) : null,
      counts: {
        all: c?.all ?? 0,
        ...(Object.fromEntries(REPLAY_FILTERS.map((f) => [f, c?.[f] ?? 0])) as Record<
          ReplayFilter,
          number
        >),
      },
    };
  }

  private async toDtos(rows: Row[], role: StaffRole): Promise<ReplaySessionDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const since = new Date(Math.min(...rows.map((r) => r.startedAt.getTime())) - 120_000);
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v))];
    const [views, customers] = await Promise.all([
      this.prisma.event.findMany({
        where: { sessionId: { in: ids }, name: 'page_view', ts: { gte: since } },
        select: { sessionId: true, path: true },
        orderBy: { ts: 'asc' },
      }),
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, publicId: true, name: true, phone: true, deletedAt: true },
          })
        : [],
    ]);
    const trail = new Map<string, string[]>();
    for (const v of views) {
      const list = trail.get(v.sessionId) ?? [];
      const p = normalizeHeatmapPath(v.path);
      if (list.at(-1) !== p) list.push(p);
      trail.set(v.sessionId, list);
    }
    const byId = new Map(customers.map((c) => [c.id, c]));
    const canSeeCustomers = hasPermission(role, 'customers.view');

    return rows.map((r) => {
      const pages = trail.get(r.id) ?? [];
      const c = r.customerId ? byId.get(r.customerId) : undefined;
      let visitor: ReplaySessionDto['visitor'];
      if (c && !c.deletedAt && c.name) {
        visitor = { kind: 'customer', label: canSeeCustomers ? shortName(c.name) : c.publicId };
      } else if (c && !c.deletedAt) {
        visitor = {
          kind: 'lead',
          label: `Lead ${canSeeCustomers && c.phone ? maskUzPhone(c.phone) : c.publicId}`,
        };
      } else if (r.lead) {
        visitor = { kind: 'lead', label: 'Lead' };
      } else {
        const tag = createHash('sha256').update(r.anonymousId).digest('hex').slice(0, 4);
        visitor = { kind: 'anonymous', label: `Anonim #${tag}` };
      }
      return {
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        durationSec: r.durationSec,
        device: r.device,
        channel: r.channel,
        region: r.region,
        visitor,
        pages: pages.slice(0, MAX_TRAIL),
        pageCount: pages.length,
        outcome: outcome(r),
        rageClicks: r.rage,
      };
    });
  }

  /** Audited (`session.view_replay`) before any recording leaves storage. */
  async open(sessionId: string, actor: AuditActor, role: StaffRole): Promise<ReplayOpenDto> {
    const rows = await this.prisma.$queryRaw<(Row & { endedAt: Date; replayKey: string | null })[]>`
      SELECT s.id, s."startedAt", s."endedAt", s."durationSec", s.device, s.channel, s.region,
             s."anonymousId", s."customerId", s."replayKey", ${FLAGS}
      FROM "Session" s WHERE s.id = ${sessionId} AND s."hasReplay"`;
    const row = rows[0];
    if (!row?.replayKey) throw new DomainError('REPLAY_NOT_FOUND');
    await this.audit.record(actor, {
      action: 'session.view_replay',
      entity: 'Session',
      entityId: sessionId,
    });

    const { keys } = await this.files.listPrivate(row.replayKey);
    keys.sort();
    const events: { timestamp: number }[] = [];
    let bytes = 0;
    let truncated = false;
    for (const key of keys) {
      const obj = await this.files.getPrivate(key);
      if (!obj) continue;
      const raw = gunzipSync(obj.body);
      bytes += raw.length;
      if (bytes > REPLAY_LIMITS.playerMaxBytes) {
        truncated = true;
        break;
      }
      // Shift to server time so the rrweb timeline lines up with `Event.ts` markers.
      const skew = Number(obj.metadata.skew ?? 0) || 0;
      for (const e of JSON.parse(raw.toString('utf8')) as { timestamp: number }[])
        events.push(skew ? { ...e, timestamp: e.timestamp + skew } : e);
    }
    if (events.length === 0) throw new DomainError('REPLAY_NOT_FOUND');
    events.sort((a, b) => a.timestamp - b.timestamp);

    const marks = await this.prisma.event.findMany({
      where: {
        sessionId,
        name: { in: Object.keys(MARKER_KIND) },
        ts: {
          gte: new Date(row.startedAt.getTime() - 120_000),
          lte: new Date(row.endedAt.getTime() + 120_000),
        },
      },
      select: { name: true, ts: true, path: true, selector: true, props: true },
      orderBy: { ts: 'asc' },
      take: MAX_MARKERS,
    });
    const markers: ReplayMarkerDto[] = marks.map((m) => {
      const kind = MARKER_KIND[m.name] ?? 'goal';
      const track = (m.props as { track?: unknown } | null)?.track;
      const label =
        kind === 'page'
          ? normalizeHeatmapPath(m.path)
          : kind === 'click' || kind === 'rage'
            ? typeof track === 'string' && track
              ? track
              : (m.selector ?? m.name)
            : m.name;
      return { ts: m.ts.getTime(), kind, label: label.slice(0, 120) };
    });

    const [session] = await this.toDtos([row], role);
    return { session: session!, events, markers, truncated };
  }
}
