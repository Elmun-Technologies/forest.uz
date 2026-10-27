import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  type HeatmapDto,
  type ReplayListDto,
  type ReplayOpenDto,
  replaySampled,
  STAFF_ROLES,
  type StaffRole,
  tashkentDayStart,
} from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { FilesService } from '../src/files/files.service';
import { HeatmapAggregatorService } from '../src/heatmaps/heatmap-aggregator.service';
import { tashkentDay } from '../src/heatmaps/heatmap-days';
import { ReplayRetentionService } from '../src/heatmaps/replay-retention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { type AdminClient, createAdminTestApp, signedIn } from './admin-helpers';
import { nextTestIp } from './app';

/** Private bucket stand-in (replay chunks), with user metadata like S3. */
class MemoryFiles extends FilesService {
  readonly objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();
  override async putPrivate(
    key: string,
    body: Buffer,
    _t: string,
    metadata: Record<string, string>,
  ) {
    this.objects.set(key, { body, metadata });
  }
  override async getPrivate(key: string) {
    return this.objects.get(key) ?? null;
  }
  override async listPrivate(prefix: string, delimiter?: string) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (!delimiter) return { keys, prefixes: [] };
    const prefixes = new Set<string>();
    for (const k of keys) {
      const rest = k.slice(prefix.length);
      const i = rest.indexOf(delimiter);
      if (i >= 0) prefixes.add(prefix + rest.slice(0, i + 1));
    }
    return { keys: [], prefixes: [...prefixes] };
  }
  override async removeManyPrivate(keys: readonly string[]) {
    for (const k of keys) this.objects.delete(k);
  }
}

const consentCookie = (replay: boolean | undefined) =>
  `fr_consent=${encodeURIComponent(
    JSON.stringify({
      v: 1,
      analytics: true,
      marketing: false,
      ts: 1,
      ...(replay === undefined ? {} : { replay }),
    }),
  )}`;

/** rrweb-shaped events; the typed values must never appear (the recorder masks them). */
const chunk = (
  events: object[] = [
    { type: 4, timestamp: Date.now(), data: { href: 'x', width: 390, height: 844 } },
  ],
) => gzipSync(Buffer.from(JSON.stringify(events)));

/** A uuid whose replay sample decision at 30 % is `sampled`. */
function sessionIdWith(sampled: boolean): string {
  for (;;) {
    const id = randomUUID();
    if (replaySampled(id, 30) === sampled) return id;
  }
}

describe('session replay + heatmaps A3 (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let files: MemoryFiles;
  let settings: SettingsService;
  const clients = new Map<StaffRole, AdminClient>();
  let trackingBefore: unknown;
  const sessions: string[] = [];
  const aid = `t-aid-${Date.now().toString(36)}`;
  const path = `/t-hm-${Date.now().toString(36)}`;

  const setRules = async (patch: Record<string, boolean | number>) => {
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'tracking.rules' } });
    await prisma.setting.update({
      where: { key: 'tracking.rules' },
      data: { value: { ...(row.value as Record<string, boolean | number>), ...patch } },
    });
    settings.invalidate();
  };

  const newSession = async (id: string, startedAt = new Date(), anonymousId = aid) => {
    sessions.push(id);
    await prisma.session.create({
      data: {
        id,
        anonymousId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 120_000),
        durationSec: 120,
        landingPath: '/uz',
        channel: 'direct',
        device: 'mobile',
      },
    });
  };

  const upload = (
    sid: string,
    opts: {
      cookieSid?: string;
      consent?: boolean;
      reason?: string;
      aid?: string;
      body?: Buffer;
    } = {},
  ) =>
    request(app.getHttpServer())
      .post(`/v1/t/replay?sid=${sid}&reason=${opts.reason ?? 'sample'}`)
      .set('X-Forwarded-For', nextTestIp())
      .set('Content-Type', 'application/octet-stream')
      .set('X-Replay-Now', String(Date.now() - 5000))
      .set(
        'Cookie',
        [
          `fr_sid=${opts.cookieSid ?? sid}`,
          `fr_aid=${opts.aid ?? aid}`,
          ...(opts.consent === undefined ? [consentCookie(true)] : [consentCookie(opts.consent)]),
        ].join('; '),
      )
      .send(opts.body ?? chunk());

  beforeAll(async () => {
    app = await createAdminTestApp([], {}, (b) =>
      b
        .overrideProvider(FilesService)
        .useFactory({ factory: (env: Env) => new MemoryFiles(env), inject: [ENV] }),
    );
    prisma = app.get(PrismaService);
    files = app.get(FilesService) as MemoryFiles;
    settings = app.get(SettingsService);
    for (const role of STAFF_ROLES) clients.set(role, (await signedIn(app, role)).client);
    trackingBefore = (await prisma.setting.findUniqueOrThrow({ where: { key: 'tracking.rules' } }))
      .value;
    await setRules({ replayEnabled: true, replaySamplePct: 30, replayCheckoutPct: 100 });
  });

  afterAll(async () => {
    await prisma.setting.update({
      where: { key: 'tracking.rules' },
      data: { value: trackingBefore as object },
    });
    await prisma.event.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.session.deleteMany({ where: { id: { in: sessions } } });
    for (const m of [prisma.heatmapCell, prisma.heatmapElement, prisma.heatmapPage] as const)
      await (m as typeof prisma.heatmapPage).deleteMany({ where: { path: { startsWith: path } } });
    await app.close();
  });

  describe('upload POST /v1/t/replay', () => {
    it('stores a chunk only for a consented, sampled, known session of this visitor', async () => {
      const sid = sessionIdWith(true);
      expect((await upload(sid)).status).toBe(409); // ingest hasn't written the session yet
      await newSession(sid);

      expect((await upload(sid, { consent: false })).status).toBe(403);
      const noField = await request(app.getHttpServer())
        .post(`/v1/t/replay?sid=${sid}`)
        .set('Content-Type', 'application/octet-stream')
        .set('Cookie', `fr_sid=${sid}; fr_aid=${aid}; ${consentCookie(undefined)}`)
        .send(chunk());
      expect(noField.status).toBe(403); // consent without the replay field = no
      expect((await upload(sid, { cookieSid: sessionIdWith(true) })).status).toBe(403);
      expect((await upload(sid, { aid: 'someone-else-aid' })).status).toBe(403);
      expect(files.objects.size).toBe(0);

      const ok = await upload(sid);
      expect(ok.status).toBe(201);
      expect((await upload(sid)).body).toEqual({ n: 2 });
      const day = tashkentDay(new Date());
      const keys = [...files.objects.keys()].filter((k) => k.includes(sid));
      expect(keys).toEqual([
        `replays/${day}/${sid}/00001.json.gz`,
        `replays/${day}/${sid}/00002.json.gz`,
      ]);
      expect(Number(files.objects.get(keys[0]!)!.metadata.skew)).toBeGreaterThanOrEqual(4000);
      const row = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
      expect(row).toMatchObject({ hasReplay: true, replayKey: `replays/${day}/${sid}/` });
    });

    it('rejects bodies that are not gzip JSON arrays of rrweb events', async () => {
      const sid = sessionIdWith(true);
      await newSession(sid);
      expect((await upload(sid, { body: Buffer.from('[{"type":2}]') })).status).toBe(400);
      expect((await upload(sid, { body: gzipSync(Buffer.from('{"a":1}')) })).status).toBe(400);
      expect((await upload(sid, { body: chunk([{ type: 2 }]) })).status).toBe(400);
      expect((await upload(sid, { body: chunk([]) })).status).toBe(400);
    });

    it('refuses other content types at once (no hanging on a consumed JSON body)', async () => {
      const sid = sessionIdWith(true);
      await newSession(sid);
      const res = await request(app.getHttpServer())
        .post(`/v1/t/replay?sid=${sid}`)
        .timeout(5000)
        .set('Content-Type', 'application/json')
        .set('Cookie', `fr_sid=${sid}; fr_aid=${aid}; ${consentCookie(true)}`)
        .send({ a: 1 });
      expect(res.status).toBe(415);
    });

    it('needs analytics not refused, and stores URLs without tokens or queries', async () => {
      const sid = sessionIdWith(true);
      await newSession(sid);
      const noAnalytics = await request(app.getHttpServer())
        .post(`/v1/t/replay?sid=${sid}`)
        .set('Content-Type', 'application/octet-stream')
        .set(
          'Cookie',
          `fr_sid=${sid}; fr_aid=${aid}; fr_consent=${encodeURIComponent(
            JSON.stringify({ v: 1, analytics: false, marketing: false, replay: true, ts: 1 }),
          )}`,
        )
        .send(chunk());
      expect(noAnalytics.status).toBe(403);

      const res = await upload(sid, {
        body: chunk([
          {
            type: 4,
            timestamp: Date.now(),
            data: { href: 'https://forest.uz/uz/t/SECRETTOKEN1?utm=x', width: 390, height: 844 },
          },
          {
            type: 3,
            timestamp: Date.now(),
            data: {
              source: 0,
              adds: [
                {
                  parentId: 1,
                  node: {
                    type: 2,
                    tagName: 'a',
                    attributes: { href: '/uz/buyurtma/SECRETID2' },
                    childNodes: [],
                  },
                },
              ],
              attributes: [],
              texts: [],
              removes: [],
            },
          },
        ]),
      });
      expect(res.status).toBe(201);
      const key = [...files.objects.keys()].find((k) => k.includes(sid))!;
      const stored = gunzipSync(files.objects.get(key)!.body).toString();
      expect(stored).not.toMatch(/SECRETTOKEN1|SECRETID2|utm=x/);
      expect(stored).toContain('https://forest.uz/uz/t/:token');
    });

    it('applies the sample rule, the checkout rate and the kill switch', async () => {
      const sid = sessionIdWith(false);
      await newSession(sid);
      expect((await upload(sid)).status).toBe(403); // outside the 30 % sample
      // `checkout` needs proof: the session's stored checkout page view (409 = retry later).
      expect((await upload(sid, { reason: 'checkout' })).status).toBe(409);
      await prisma.event.create({
        data: {
          id: randomUUID(),
          ts: new Date(),
          sessionId: sid,
          anonymousId: aid,
          name: 'page_view',
          path: '/ru/checkout',
        },
      });
      expect((await upload(sid, { reason: 'checkout' })).status).toBe(201); // checkout = 100 %
      await setRules({ replayEnabled: false });
      try {
        expect((await upload(sid, { reason: 'checkout' })).status).toBe(403);
      } finally {
        await setRules({ replayEnabled: true });
      }
    });
  });

  describe('admin replays', () => {
    let sid: string;

    beforeAll(async () => {
      sid = sessionIdWith(true);
      await newSession(sid);
      const t0 = Date.now();
      await upload(sid, {
        body: chunk([
          {
            type: 4,
            timestamp: t0,
            data: { href: 'http://x/uz/checkout', width: 390, height: 844 },
          },
          {
            type: 3,
            timestamp: t0 + 1000,
            data: { source: 5, text: '•••', isChecked: false, id: 7 },
          },
        ]),
      });
      await prisma.event.createMany({
        data: [
          {
            id: randomUUID(),
            ts: new Date(t0),
            sessionId: sid,
            anonymousId: aid,
            name: 'page_view',
            path: '/uz/checkout',
          },
          {
            id: randomUUID(),
            ts: new Date(t0 + 2000),
            sessionId: sid,
            anonymousId: aid,
            name: 'add_to_cart',
            path: '/uz/checkout',
            props: { variantId: 'v1', qty: 1 },
          },
        ],
      });
    });

    it('lists replay sessions with outcome filters (analytics.view only)', async () => {
      const mk = await clients.get('MARKETER')!.get('/v1/admin/replays?filter=abandoned');
      expect(mk.status).toBe(200);
      const body = mk.body as ReplayListDto;
      const item = body.items.find((i) => i.id === sid);
      expect(item).toMatchObject({ outcome: 'abandoned', pages: ['/checkout'] });
      expect(item!.visitor.label).toMatch(/^Anonim #[0-9a-f]{4}$/);
      expect(body.counts.abandoned).toBeGreaterThanOrEqual(1);
      expect((await clients.get('OPERATOR')!.get('/v1/admin/replays')).status).toBe(403);
      expect((await clients.get('WAREHOUSE')!.get('/v1/admin/replays')).status).toBe(403);
    });

    it('opening a replay is audited and returns events shifted to server time + markers', async () => {
      const owner = clients.get('OWNER')!;
      const res = await owner.post(`/v1/admin/replays/${sid}/open`);
      expect(res.status).toBe(201);
      const body = res.body as ReplayOpenDto;
      expect(body.events).toHaveLength(2);
      expect(body.markers.map((m) => m.kind)).toEqual(['page', 'goal']);
      expect(body.session.id).toBe(sid);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'session.view_replay', entityId: sid },
      });
      expect(audit).not.toBeNull();
      expect((await clients.get('OPERATOR')!.post(`/v1/admin/replays/${sid}/open`)).status).toBe(
        403,
      );
      expect((await owner.post(`/v1/admin/replays/${sessionIdWith(true)}/open`)).status).toBe(404);
    });

    it('replay settings: everyone with analytics.view reads, only the Owner saves (audited)', async () => {
      const mk = clients.get('MARKETER')!;
      const doc = (await mk.get('/v1/admin/heatmaps/settings')).body as {
        value: Record<string, unknown>;
        version: string;
      };
      expect(doc.value).toMatchObject({ replayEnabled: true, replaySamplePct: 30 });
      const body = { value: { ...doc.value, replaySamplePct: 40 }, version: doc.version };
      expect((await mk.send('put', '/v1/admin/heatmaps/settings', body)).status).toBe(403);
      const saved = await clients.get('OWNER')!.send('put', '/v1/admin/heatmaps/settings', body);
      expect(saved.status).toBe(200);
      expect(saved.body.value.replaySamplePct).toBe(40);
      expect(
        (await clients.get('OWNER')!.send('put', '/v1/admin/heatmaps/settings', body)).status,
      ).toBe(409); // stale version
      await setRules({ replaySamplePct: 30 });
    });
  });

  it('retention deletes replay folders older than 30 days and clears the flags', async () => {
    const oldStart = new Date(Date.now() - 40 * 86_400_000);
    const oldSid = randomUUID();
    await newSession(oldSid, oldStart);
    const oldPrefix = `replays/${tashkentDay(oldStart)}/${oldSid}/`;
    await prisma.session.update({
      where: { id: oldSid },
      data: { hasReplay: true, replayKey: oldPrefix },
    });
    files.objects.set(`${oldPrefix}00001.json.gz`, { body: chunk(), metadata: {} });
    files.objects.set(`replays/${tashkentDay(oldStart)}/orphan/00001.json.gz`, {
      body: chunk(),
      metadata: {},
    });
    const recent = [...files.objects.keys()].filter(
      (k) => !k.startsWith(`replays/${tashkentDay(oldStart)}`),
    );

    const res = await app.get(ReplayRetentionService).purge();
    expect(res.objects).toBe(2);
    expect([...files.objects.keys()].sort()).toEqual(recent.sort());
    expect(await prisma.session.findUniqueOrThrow({ where: { id: oldSid } })).toMatchObject({
      hasReplay: false,
      replayKey: null,
    });
  });

  it('aggregates click/rage/dead/scroll/LCP events into day buckets and serves A3', async () => {
    const now = new Date();
    const base = tashkentDayStart(now).getTime() + 60_000; // today 00:01 Tashkent
    const ev = (sid: string, name: string, offsetMs: number, extra: object = {}) => ({
      id: randomUUID(),
      ts: new Date(base + offsetMs),
      sessionId: sid,
      anonymousId: aid,
      name,
      path: `/uz${path}`,
      ...extra,
    });
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    for (const s of [a, b, c]) await newSession(s, new Date(base));
    const click = (x: number, y: number, extra: object = {}) => ({
      selector: 'main>button',
      x,
      y,
      viewportW: 390,
      props: { track: 'prices' },
      ...extra,
    });
    await prisma.event.createMany({
      data: [
        ev(a, 'page_view', 0, { viewportW: 390 }),
        ev(a, 'click', 1000, click(505, 1213)),
        ev(a, 'click', 2000, click(510, 1219)),
        ev(a, 'rage_click', 2100, click(510, 1219)),
        ev(a, 'scroll_depth', 3000, { scrollDepth: 50 }),
        ev(a, 'page_view', 4000, { path: `/uz${path}-next` }), // a's clicks are not exits
        ev(b, 'page_view', 0, { viewportW: 390 }),
        ev(b, 'click', 1000, click(999, 40, { selector: 'main>img', props: {} })),
        ev(b, 'dead_click', 2000, click(999, 40, { selector: 'main>img', props: {} })),
        ev(b, 'scroll_depth', 3000, { scrollDepth: 25 }),
        ev(b, 'scroll_depth', 3500, { scrollDepth: 100 }),
        ev(b, 'web_vitals', 3600, {
          props: { metric: 'LCP', value: 3100, rating: 'needs-improvement' },
        }),
        ev(c, 'page_view', 0, { viewportW: 1440 }), // desktop
        ev(c, 'click', 1000, { ...click(100, 300), viewportW: 1440 }),
        ev(c, 'web_vitals', 1100, { props: { metric: 'LCP', value: 1200, rating: 'good' } }),
      ],
    });

    // Run "an hour later" so the last clicks count as session exits (sessions idle 30 min).
    await app.get(HeatmapAggregatorService).aggregate(1, new Date(base + 3_600_000));
    const day = new Date(`${tashkentDay(now)}T00:00:00.000Z`);
    const cells = await prisma.heatmapCell.findMany({
      where: { path, day },
      orderBy: [{ device: 'asc' }, { kind: 'asc' }, { x: 'asc' }],
    });
    expect(cells.map((r) => [r.device, r.kind, r.x, r.y, r.count])).toEqual([
      ['desktop', 'click', 100, 300, 1],
      ['mobile', 'click', 500, 1200, 2],
      ['mobile', 'click', 980, 40, 1],
      ['mobile', 'dead', 980, 40, 1],
      ['mobile', 'rage', 500, 1200, 1],
    ]);
    const elements = await prisma.heatmapElement.findMany({
      where: { path, day, device: 'mobile' },
      orderBy: { selector: 'asc' },
    });
    expect(elements.map((e) => [e.selector, e.label, e.clicks, e.rage, e.dead, e.exits])).toEqual([
      ['main>button', 'prices', 2, 1, 0, 0],
      ['main>img', null, 1, 0, 1, 1],
    ]);
    const mobile = await prisma.heatmapPage.findUniqueOrThrow({
      where: { day_path_device: { day, path, device: 'mobile' } },
    });
    expect(mobile).toMatchObject({
      sessions: 2,
      pageviews: 2,
      reach25: 2,
      reach50: 2,
      reach75: 1,
      reach100: 1,
      scrollSum: 150,
      clicks: 3,
      rage: 1,
      dead: 1,
      lcpCount: 1,
      lcpSlow: 1,
    });
    expect(mobile.lcpSumMs).toBe(3100n);

    // Idempotent: a second run rebuilds the same day.
    await app.get(HeatmapAggregatorService).aggregate(1, new Date(base + 3_600_000));
    expect(await prisma.heatmapCell.count({ where: { path, day } })).toBe(cells.length);

    const res = await clients
      .get('MARKETER')!
      .get(`/v1/admin/heatmaps?path=${encodeURIComponent(path)}&device=mobile&days=7`);
    expect(res.status).toBe(200);
    const dto = res.body as HeatmapDto;
    expect(dto.kpis).toEqual({ sessions: 2, avgScrollPct: 75, rageClicks: 1, deadClicks: 1 });
    expect(dto.scroll.map((s) => s.reachedPct)).toEqual([100, 100, 50, 50]);
    expect(dto.elements[0]).toMatchObject({ selector: 'main>button', clicks: 2 });
    const pages = await clients.get('OWNER')!.get('/v1/admin/heatmaps/pages?device=mobile&days=7');
    expect(pages.body.pages).toContainEqual({ path, sessions: 2 });
    expect((await clients.get('OPERATOR')!.get('/v1/admin/heatmaps')).status).toBe(403);
    expect(
      (await clients.get('MARKETER')!.post('/v1/admin/heatmaps/refresh', { days: 1 })).status,
    ).toBe(201);
  });
});
