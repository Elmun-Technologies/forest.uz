import { scrubPath } from './tracking';

/**
 * Session replay and heatmaps (docs/07, admin A3). Zod-free: shared by the storefront replay gate,
 * the recorder bundle, the API (upload checks, aggregation) and the admin UI.
 */

// ───────────────────────── Replay ─────────────────────────

/** Replays (objects + flags) are deleted after this many days (docs/14). */
export const REPLAY_RETENTION_DAYS = 30;

/** Upload caps for `POST /v1/t/replay` (CLAUDE.md §6). */
export const REPLAY_LIMITS = {
  chunkCompressedBytes: 512 * 1024,
  chunkDecompressedBytes: 5 * 1024 * 1024,
  /** 2 h of 10 s chunks. */
  chunksPerSession: 720,
  sessionCompressedBytes: 40 * 1024 * 1024,
  /** All sessions together per Tashkent day (storage cost guard; beyond → 413, recording stops). */
  dailyCompressedBytes: 5 * 1024 * 1024 * 1024,
  chunksPerMinutePerSession: 30,
  chunksPerMinutePerIp: 120,
  /** The recorder uploads this often. */
  flushMs: 10_000,
  /** Admin player: stop loading chunks beyond this decompressed size. */
  playerMaxBytes: 60 * 1024 * 1024,
} as const;

export const REPLAY_REASONS = ['sample', 'checkout'] as const;
export type ReplayReason = (typeof REPLAY_REASONS)[number];

/** FNV-1a 32-bit — tiny, stable across browser and server. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic sampling: the same session id gets the same answer on every page and on the
 * server. Sessions sampled at a lower rate are a subset of those sampled at a higher one.
 */
export function replaySampled(sessionId: string, pct: number): boolean {
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return fnv1a(sessionId) % 100 < pct;
}

/** Public replay settings (`PublicSettingsDto.replay`). */
export interface ReplayGateConfig {
  enabled: boolean;
  samplePct: number;
  checkoutPct: number;
}

/**
 * Should this session be recorded, and why? `sample` = the general sample; `checkout` = the
 * session reached checkout (now or earlier in the same tab) and falls in the checkout rate.
 * The server re-checks the same rule on every chunk.
 */
export function replayReason(input: {
  sessionId: string;
  config: ReplayGateConfig;
  checkout: boolean;
}): ReplayReason | null {
  const { sessionId, config } = input;
  if (!config.enabled) return null;
  if (replaySampled(sessionId, config.samplePct)) return 'sample';
  if (input.checkout && replaySampled(sessionId, config.checkoutPct)) return 'checkout';
  return null;
}

/** The storefront checkout route (UZ slug, same in both locales). */
export function isCheckoutPath(path: string): boolean {
  return /^\/(?:(?:uz|ru)\/)?checkout(?:[/?#]|$)/.test(path);
}

/** Object key prefix of one session's replay: `replays/<day>/<sessionId>/`. */
export function replayPrefix(day: string, sessionId: string): string {
  return `replays/${day}/${sessionId}/`;
}

/** Strict session-id shape accepted by the upload (tracker UUIDs; nothing path-like). */
export const REPLAY_SESSION_ID_RE = /^[0-9a-zA-Z-]{8,64}$/;

/** URL attributes that may carry capability tokens or query strings (links, forms). */
const URL_ATTRIBUTES = new Set(['href', 'action', 'formaction', 'ping']);

/**
 * A URL as it may be stored in a recording: http(s) and relative URLs lose query and hash and
 * get `scrubPath` (tracking token, order id, phone/email-like segments → placeholders); build
 * assets (`/_next/…`) stay as they are (the player needs them); other schemes are kept.
 */
export function scrubReplayUrl(value: string): string {
  const v = value.trim();
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//');
  if (absolute && !/^(?:https?:)?\/\//i.test(v)) return value; // tel:, mailto:, data:, blob:…
  let url: URL;
  try {
    url = new URL(v, 'http://relative.invalid');
  } catch {
    return value;
  }
  if (url.pathname.startsWith('/_next/')) return value;
  const path = scrubPath(url.pathname);
  return absolute ? `${url.origin}${path}` : path;
}

interface SerializedNode {
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
}

function scrubAttributes(attrs: Record<string, unknown> | undefined): void {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs))
    if (typeof value === 'string' && URL_ATTRIBUTES.has(name.toLowerCase()))
      attrs[name] = scrubReplayUrl(value);
}

function scrubNode(node: SerializedNode | undefined): void {
  if (!node) return;
  scrubAttributes(node.attributes);
  for (const child of node.childNodes ?? []) scrubNode(child);
}

/**
 * Removes URLs that could carry secrets from one rrweb event, in place: the page URL of Meta
 * events (type 4) and link/form URL attributes of full snapshots (type 2) and DOM mutations
 * (type 3, source 0). Run by the recorder before upload and again by the API on every chunk.
 */
export function scrubReplayEvent<E>(event: E): E {
  const e = event as { type?: unknown; data?: Record<string, unknown> } | null;
  const data = e?.data;
  if (!e || !data || typeof data !== 'object') return event;
  if (e.type === 4 && typeof data.href === 'string') data.href = scrubReplayUrl(data.href);
  else if (e.type === 2) scrubNode(data.node as SerializedNode | undefined);
  else if (e.type === 3 && data.source === 0) {
    for (const add of (data.adds as { node?: SerializedNode }[] | undefined) ?? [])
      scrubNode(add.node);
    for (const change of (data.attributes as
      { attributes?: Record<string, unknown> }[] | undefined) ?? [])
      scrubAttributes(change.attributes);
  }
  return event;
}

// ───────────────────────── Heatmaps ─────────────────────────

export const HEATMAP_DEVICES = ['mobile', 'desktop'] as const;
export type HeatmapDevice = (typeof HEATMAP_DEVICES)[number];

/** `move` is not collected by the tracker (no mousemove events): shown disabled in A3. */
export const HEATMAP_TYPES = ['click', 'scroll', 'move'] as const;
export type HeatmapType = (typeof HEATMAP_TYPES)[number];

export const HEATMAP_PERIODS = [7, 30, 90] as const;
export type HeatmapPeriod = (typeof HEATMAP_PERIODS)[number];

/** Rendering widths of the page backdrop (design: desktop 1440, mobile 390). */
export const HEATMAP_FRAME_WIDTH: Record<HeatmapDevice, number> = { desktop: 1440, mobile: 390 };

/** Grid steps: x in ‰ of the document width, y in document px. */
export const HEATMAP_X_STEP = 20;
export const HEATMAP_Y_STEP = 20;

export const SCROLL_DEPTHS = [25, 50, 75, 100] as const;
export type ScrollDepth = (typeof SCROLL_DEPTHS)[number];

/** Layout class for a viewport width: the storefront's `md` breakpoint is 768 px. */
export function heatmapDevice(viewportW: number | null | undefined, sessionDevice?: string | null) {
  if (typeof viewportW === 'number' && viewportW > 0) return viewportW < 768 ? 'mobile' : 'desktop';
  return sessionDevice === 'mobile' ? 'mobile' : 'desktop';
}

/** `/uz/katalog?page=2` → `/katalog`; heatmaps merge both locales (same layout). */
export function normalizeHeatmapPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  const stripped = bare.replace(/^\/(?:uz|ru)(?=\/|$)/, '');
  const clean = stripped.length > 1 ? stripped.replace(/\/+$/, '') : stripped;
  return clean === '' ? '/' : clean;
}

export function heatmapBin(value: number, step: number, max?: number): number {
  const v = Math.max(0, max === undefined ? value : Math.min(value, max - 1));
  return Math.floor(v / step) * step;
}

/** Thresholds of the auto-detected problems (docs/07 A3) — the only place they live. */
export const HEATMAP_INSIGHT_RULES = {
  /** Below this many sessions on the page (selected device) no problem is reported. */
  minSessions: 30,
  deadClicks: { minCount: 10, minShare: 0.3, highShare: 0.5, top: 3 },
  rageHotspots: { minCount: 5, highCount: 20, top: 3 },
  /** A scroll depth reached by fewer than this share of mobile sessions. */
  mobileReach: { maxShare: 0.5 },
  exitAfterCta: { minClicks: 20, minShare: 0.3, top: 2 },
  /** p75 LCP > 2.5 s ⇔ more than 25 % of samples above 2.5 s. */
  slowLcp: { thresholdMs: 2500, minSamples: 20, slowShare: 0.25 },
  maxInsights: 6,
} as const;

export interface HeatmapPageAgg {
  sessions: number;
  pageviews: number;
  reach: Record<ScrollDepth, number>;
  /** Σ of the max scroll depth per session (0 when none). */
  scrollSum: number;
  clicks: number;
  rage: number;
  dead: number;
  lcpCount: number;
  lcpSlow: number;
  lcpSumMs: number;
}

export interface HeatmapElementStat {
  selector: string;
  /** Short element label when the tracker sent one; else null (UI shows the selector). */
  label: string | null;
  clicks: number;
  rage: number;
  dead: number;
  /** Clicks after which the session ended (no further page view or click). */
  exits: number;
}

export type InsightSeverity = 'high' | 'medium';

export type HeatmapInsight =
  | {
      kind: 'slow_lcp';
      severity: InsightSeverity;
      slowPct: number;
      avgMs: number;
      samples: number;
    }
  | {
      kind: 'exit_after_cta';
      severity: InsightSeverity;
      selector: string;
      label: string | null;
      exitPct: number;
      clicks: number;
    }
  | {
      kind: 'dead_clicks';
      severity: InsightSeverity;
      selector: string;
      label: string | null;
      dead: number;
      sharePct: number;
    }
  | {
      kind: 'rage_hotspot';
      severity: InsightSeverity;
      selector: string;
      label: string | null;
      rage: number;
    }
  | {
      kind: 'mobile_reach';
      severity: InsightSeverity;
      depth: ScrollDepth;
      notReachedPct: number;
      sessions: number;
    };

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/** A link or button (the CSS path's last step), or anything marked `data-cta`. */
export function isCtaSelector(selector: string): boolean {
  if (selector.includes('[data-cta')) return true;
  const last = selector.split('>').at(-1)?.trim() ?? '';
  const tag = /^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase();
  return tag === 'a' || tag === 'button';
}

/**
 * Auto-detected problems for one page × device (docs/07): slow LCP, exits right after a CTA,
 * dead-click and rage-click hotspots, and (from the mobile numbers) the first scroll depth that
 * fewer than half of mobile sessions reach.
 */
export function heatmapInsights(input: {
  page: HeatmapPageAgg | null;
  mobile: HeatmapPageAgg | null;
  elements: readonly HeatmapElementStat[];
}): HeatmapInsight[] {
  const R = HEATMAP_INSIGHT_RULES;
  const out: HeatmapInsight[] = [];
  const page = input.page;

  if (page && page.sessions >= R.minSessions) {
    if (
      page.lcpCount >= R.slowLcp.minSamples &&
      page.lcpSlow / page.lcpCount > R.slowLcp.slowShare
    ) {
      const slowPct = pct(page.lcpSlow, page.lcpCount);
      out.push({
        kind: 'slow_lcp',
        severity: slowPct >= 50 ? 'high' : 'medium',
        slowPct,
        avgMs: Math.round(page.lcpSumMs / page.lcpCount),
        samples: page.lcpCount,
      });
    }

    const exits = input.elements
      .filter(
        (e) =>
          isCtaSelector(e.selector) &&
          e.clicks >= R.exitAfterCta.minClicks &&
          e.exits / e.clicks >= R.exitAfterCta.minShare,
      )
      .sort((a, b) => b.exits / b.clicks - a.exits / a.clicks || b.clicks - a.clicks)
      .slice(0, R.exitAfterCta.top);
    for (const e of exits)
      out.push({
        kind: 'exit_after_cta',
        severity: 'high',
        selector: e.selector,
        label: e.label,
        exitPct: pct(e.exits, e.clicks),
        clicks: e.clicks,
      });

    const dead = input.elements
      .map((e) => ({ e, share: e.dead / Math.max(e.clicks, e.dead) }))
      .filter(({ e, share }) => e.dead >= R.deadClicks.minCount && share >= R.deadClicks.minShare)
      .sort((a, b) => b.e.dead - a.e.dead)
      .slice(0, R.deadClicks.top);
    for (const { e, share } of dead)
      out.push({
        kind: 'dead_clicks',
        severity: share >= R.deadClicks.highShare ? 'high' : 'medium',
        selector: e.selector,
        label: e.label,
        dead: e.dead,
        sharePct: Math.round(share * 100),
      });

    const rage = input.elements
      .filter((e) => e.rage >= R.rageHotspots.minCount)
      .sort((a, b) => b.rage - a.rage)
      .slice(0, R.rageHotspots.top);
    for (const e of rage)
      out.push({
        kind: 'rage_hotspot',
        severity: e.rage >= R.rageHotspots.highCount ? 'high' : 'medium',
        selector: e.selector,
        label: e.label,
        rage: e.rage,
      });
  }

  const mobile = input.mobile;
  if (mobile && mobile.sessions >= R.minSessions) {
    const depth = SCROLL_DEPTHS.find(
      (d) => mobile.reach[d] / mobile.sessions < R.mobileReach.maxShare,
    );
    if (depth !== undefined && depth !== 100) {
      const notReachedPct = 100 - pct(mobile.reach[depth], mobile.sessions);
      out.push({
        kind: 'mobile_reach',
        severity: depth <= 50 ? 'high' : 'medium',
        depth,
        notReachedPct,
        sessions: mobile.sessions,
      });
    }
  }

  return out.slice(0, R.maxInsights);
}

/** Average of the max scroll depth per session, in %; null without sessions. */
export function avgScrollPct(page: Pick<HeatmapPageAgg, 'sessions' | 'scrollSum'> | null) {
  if (!page || page.sessions === 0) return null;
  return Math.round(page.scrollSum / page.sessions);
}

// ───────────────────────── Admin DTOs ─────────────────────────

export interface HeatmapCellDto {
  /** Bin start: ‰ of document width. */
  x: number;
  /** Bin start: document px. */
  y: number;
  count: number;
}

export interface HeatmapDto {
  path: string;
  device: HeatmapDevice;
  days: number;
  /** Tashkent days, inclusive. */
  from: string;
  to: string;
  kpis: {
    sessions: number;
    avgScrollPct: number | null;
    rageClicks: number;
    deadClicks: number;
  };
  clicks: HeatmapCellDto[];
  rage: HeatmapCellDto[];
  scroll: { depth: ScrollDepth; reachedPct: number | null }[];
  elements: HeatmapElementStat[];
  insights: HeatmapInsight[];
  /** When `heatmaps.aggregate` last finished (null = never). */
  aggregatedAt: string | null;
}

export interface HeatmapPagesDto {
  device: HeatmapDevice;
  days: number;
  pages: { path: string; sessions: number }[];
}

export const REPLAY_FILTERS = ['abandoned', 'purchased', 'rage', 'lead'] as const;
export type ReplayFilter = (typeof REPLAY_FILTERS)[number];

export type ReplayOutcome = 'purchased' | 'abandoned' | 'lead' | 'rage' | 'exited';

export interface ReplaySessionDto {
  id: string;
  startedAt: string;
  durationSec: number;
  device: string;
  channel: string;
  region: string | null;
  visitor: { kind: 'customer' | 'lead' | 'anonymous'; label: string };
  /** Normalized paths of the session's page views, in order (≤ 8). */
  pages: string[];
  pageCount: number;
  outcome: ReplayOutcome;
  rageClicks: number;
}

export interface ReplayListDto {
  items: ReplaySessionDto[];
  nextCursor: string | null;
  /** Replay sessions in the period per filter chip (other filters applied). */
  counts: Record<ReplayFilter, number> & { all: number };
}

export type ReplayMarkerKind = 'page' | 'click' | 'error' | 'exit' | 'rage' | 'goal';

export interface ReplayMarkerDto {
  /** ms epoch (client clock, like rrweb timestamps). */
  ts: number;
  kind: ReplayMarkerKind;
  /** Path, selector or event name — never user-typed text. */
  label: string;
}

export interface ReplayOpenDto {
  session: ReplaySessionDto;
  /** rrweb events, sorted by timestamp. */
  events: unknown[];
  markers: ReplayMarkerDto[];
  /** True when the replay was cut at `REPLAY_LIMITS.playerMaxBytes`. */
  truncated: boolean;
}

export interface ReplaySettingsValue {
  replayEnabled: boolean;
  replaySamplePct: number;
  replayCheckoutPct: number;
}

export interface ReplaySettingsDto {
  value: ReplaySettingsValue;
  version: string;
}
