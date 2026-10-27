import type { TrackEventName, TrackPropsMap } from '@forest/contracts/core';
// The source module, not the package entry: the bundled entry carries other modules' top-level
// tables, which esbuild can't tree-shake out of an IIFE (≈ +4 KB gz).
import { scrubPath } from '../../contracts/src/tracking';

/**
 * Forest first-party tracker (docs/07 "Tracker"). Runs on the storefront after idle; batches
 * events to `POST /api/t` (→ API `/v1/t`). Never reads `fr_aid` (httpOnly, set by the API) and
 * never captures input values or text content.
 */

export const ENDPOINT = '/api/t';
export const FLUSH_MS = 5000;
export const FLUSH_COUNT = 20;
export const IDLE_MS = 30 * 60_000;
const SID_COOKIE = 'fr_sid';
const CAMPAIGN_KEY = 'fr_sc';
const RAGE_CLICKS = 3;
const RAGE_MS = 700;
const RAGE_PX = 30;
const DEAD_MS = 1000;
const MAX_ERRORS = 5;
/** `data-track` values that are goals on click (Phase 1 placed these hooks on links/buttons). */
const CLICK_GOALS: Record<string, 'telegram_click' | 'video_play'> = {
  telegram_click: 'telegram_click',
  video_play: 'video_play',
};
const TELEGRAM_LINK = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/|^tg:/i;
const UTM = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const CLICK_IDS = ['gclid', 'fbclid', 'ttclid', 'yclid'] as const;

type Props = Record<string, unknown>;
interface WireEvent {
  id: string;
  name: string;
  t: number;
  path: string;
  props?: Props;
  selector?: string;
  x?: number;
  y?: number;
  viewportW?: number;
  scrollDepth?: number;
}
export interface Consent {
  analytics: boolean;
  marketing: boolean;
  replay?: boolean;
}

/** Public surface on `window.__forestTracker` (README: replay recorder hook). */
export interface TrackerApi {
  /** Current session id (UUID v7) or null while tracking is off. */
  sessionId(): string | null;
  /** Parsed `fr_consent` (null = no decision yet). */
  consent(): Consent | null;
  /** Called with the new consent whenever the visitor decides; returns an unsubscribe. */
  onConsent(fn: (c: Consent) => void): () => void;
  /** Called with the new id whenever a session starts (incl. the current one, at once). */
  onSession(fn: (sessionId: string) => void): () => void;
  track<N extends TrackEventName>(name: N, props?: TrackPropsMap[N]): void;
  /** Sends what is queued now (sendBeacon). */
  flush(): void;
}

type Win = Window & typeof globalThis;
type QueueItem = [string, Props | undefined, number?];

export function uuid7(now: number, crypto: Crypto): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  let h = '';
  for (const x of b) h += (x < 16 ? '0' : '') + x.toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable CSS path for heatmaps: `#id` anchor or tag:nth-of-type steps up to <body>, ≤ 200 chars. */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
    const id = cur.id;
    // React useId values (`:r1:`, `«r1»`) change between renders → not stable.
    if (id && /^[A-Za-z][\w-]*$/.test(id)) {
      parts.unshift(`#${id}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    let part = tag;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
  }
  return parts.join('>').slice(-200);
}

/** Error text without query strings of URLs (they may carry tokens). */
export function cleanMessage(msg: string): string {
  return msg.replace(/(https?:\/\/[^\s?#'"]*)[?#][^\s'"]*/g, '$1').slice(0, 200);
}

const readCookie = (doc: Document, name: string): string | null => {
  const m = doc.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? (m[1] ?? null) : null;
};

export function parseConsent(raw: string | null): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<Consent> | null;
    return v && typeof v.analytics === 'boolean'
      ? { analytics: v.analytics, marketing: v.marketing === true, replay: v.replay === true }
      : null;
  } catch {
    return null;
  }
}

const rating = (v: number, good: number, poor: number) =>
  v <= good ? 'good' : v > poor ? 'poor' : 'needs-improvement';

export function install(win: Win, endpoint = ENDPOINT): TrackerApi {
  const doc = win.document;
  const nav = win.navigator;
  const loc = win.location;
  const store = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Storage blocked (private mode, sandbox): the cookie alone carries the session.
    }
  };
  let queue: WireEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let sid: string | null = null;
  let on = false;
  let consent = parseConsent(readCookie(doc, 'fr_consent'));
  let path = '';
  let pageStart = 0;
  let maxScroll = 0;
  let depths = new Set<number>();
  let errors = 0;
  let clicks: { x: number; y: number; t: number }[] = [];
  let lastCookieWrite = 0;
  const consentFns: ((c: Consent) => void)[] = [];
  const sessionFns: ((id: string) => void)[] = [];
  const vitals: { lcp: number; cls: number; inp: number; sent: boolean } = {
    lcp: 0,
    cls: 0,
    inp: 0,
    sent: false,
  };

  const now = () => Date.now();
  const params = () => new URLSearchParams(loc.search);

  function writeSid(id: string | null) {
    const secure = loc.protocol === 'https:' ? '; Secure' : '';
    doc.cookie = id
      ? `${SID_COOKIE}=${id}; Path=/; Max-Age=${IDLE_MS / 1000}; SameSite=Lax${secure}`
      : `${SID_COOKIE}=; Path=/; Max-Age=0`;
    lastCookieWrite = now();
  }

  /**
   * The live session: the `fr_sid` cookie (shared by tabs, expires after 30 min without events);
   * a missing cookie starts a new session on the current page.
   */
  function session(): string {
    const cookie = readCookie(doc, SID_COOKIE);
    if (sid && cookie === sid) {
      // Renewing the cookie on every event is cheap but pointless more than every 15 s.
      if (now() - lastCookieWrite > 15_000) writeSid(sid);
      return sid;
    }
    if (cookie && /^[0-9a-f-]{36}$/.test(cookie)) {
      // Another tab (or an earlier page) started it: join, one session per batch.
      if (queue.length) flush();
      sid = cookie;
      writeSid(sid);
      for (const fn of sessionFns) fn(sid);
    } else startSession(false);
    return sid!;
  }

  function startSession(fromLanding: boolean) {
    if (queue.length) flush();
    sid = uuid7(now(), win.crypto);
    writeSid(sid);
    if (!fromLanding) {
      // Resumed after inactivity: the new session starts on the current page (no acquisition).
      queue.push(event('page_view', { landing: true, nav: 'load' }));
      store(() => win.sessionStorage.setItem(CAMPAIGN_KEY, ''));
    }
    for (const fn of sessionFns) fn(sid);
  }

  function event(name: string, props?: Props, extra?: Partial<WireEvent>, t = now()): WireEvent {
    return {
      id: uuid7(t, win.crypto),
      name,
      t,
      path: path || scrubPath(loc.pathname),
      props,
      ...extra,
    };
  }

  function push(name: string, props?: Props, extra?: Partial<WireEvent>, t?: number) {
    if (!on) return;
    session();
    queue.push(event(name, props, extra, t));
    if (queue.length >= FLUSH_COUNT) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (!queue.length || !sid) return;
    const body = JSON.stringify({
      v: 1,
      sid,
      now: now(),
      wd: nav.webdriver === true,
      events: queue,
    });
    queue = [];
    const blob = new Blob([body], { type: 'text/plain' });
    try {
      if (nav.sendBeacon?.(endpoint, blob)) return;
    } catch {
      // Fall through to fetch.
    }
    void win
      .fetch(endpoint, { method: 'POST', body, keepalive: true, credentials: 'same-origin' })
      .catch(() => undefined);
  }

  // ───────── pages ─────────

  function landing(): Props {
    const q = params();
    const utm: Props = {};
    const ids: Props = {};
    for (const k of UTM) {
      const v = q.get(`utm_${k}`);
      if (v) utm[k] = v.slice(0, 100);
    }
    for (const k of CLICK_IDS) {
      const v = q.get(k);
      if (v) ids[k] = v.slice(0, 200);
    }
    let referrer: string | undefined;
    try {
      const r = doc.referrer ? new URL(doc.referrer) : null;
      if (r && r.host !== loc.host) referrer = `${r.origin}${r.pathname}`.slice(0, 300);
    } catch {
      // Unparseable referrer: none.
    }
    return {
      landing: true,
      ...(referrer ? { referrer } : {}),
      ...(Object.keys(utm).length ? { utm } : {}),
      ...(Object.keys(ids).length ? { clickIds: ids } : {}),
    };
  }

  function pageView(kind: 'load' | 'spa') {
    path = scrubPath(loc.pathname);
    pageStart = now();
    maxScroll = 0;
    depths = new Set();
    errors = 0;
    const seg = path.split('/')[1];
    const locale = seg === 'uz' || seg === 'ru' ? { locale: seg } : {};
    if (kind === 'load') {
      const q = params();
      const campaign = q.get('utm_campaign') ?? (CLICK_IDS.some((k) => q.get(k)) ? '(click)' : '');
      let stored: string | null = null;
      store(() => (stored = win.sessionStorage.getItem(CAMPAIGN_KEY)));
      const cookie = readCookie(doc, SID_COOKIE);
      const fresh = !cookie || (campaign !== '' && campaign !== stored);
      if (fresh) {
        startSession(true);
        store(() => win.sessionStorage.setItem(CAMPAIGN_KEY, campaign));
        push('page_view', { ...landing(), nav: kind, ...locale });
        return;
      }
    }
    push('page_view', { nav: kind, ...locale });
  }

  function onRoute() {
    // Next calls replaceState for its own state on every navigation: only a new path counts.
    setTimeout(() => {
      if (on && scrubPath(loc.pathname) !== path) pageView('spa');
    }, 0);
  }

  // ───────── interactions ─────────

  function clickFields(el: Element, e: MouseEvent): Partial<WireEvent> {
    const docW = Math.max(doc.documentElement.scrollWidth, 1);
    return {
      selector: cssPath(el),
      x: Math.min(1000, Math.max(0, Math.round((e.pageX / docW) * 1000))),
      y: Math.max(0, Math.round(e.pageY)),
      viewportW: win.innerWidth,
    };
  }

  function onClick(e: MouseEvent) {
    const target = e.target instanceof win.Element ? e.target : null;
    if (!target) return;
    const el =
      target.closest('a,button,input,select,textarea,label,summary,[role=button],[data-track]') ??
      target;
    const tracked = el.closest('[data-track]');
    const track = tracked?.getAttribute('data-track') ?? undefined;
    const fields = clickFields(el, e);
    const props: Props = { tag: el.tagName.toLowerCase(), ...(track ? { track } : {}) };
    push('click', props, fields);

    const href = el.closest('a')?.getAttribute('href') ?? '';
    const goal =
      (track && CLICK_GOALS[track]) || (TELEGRAM_LINK.test(href) ? 'telegram_click' : null);
    if (goal) push(goal, {}, fields);

    const t = now();
    clicks = clicks.filter(
      (c) => t - c.t < RAGE_MS && Math.hypot(c.x - e.clientX, c.y - e.clientY) < RAGE_PX,
    );
    clicks.push({ x: e.clientX, y: e.clientY, t });
    if (clicks.length === RAGE_CLICKS) push('rage_click', { ...props, count: RAGE_CLICKS }, fields);

    // Form controls (focus only) and links that leave the page never change this document.
    const a = el.closest('a');
    const leaves =
      a && (a.target === '_blank' || (a.href && new URL(a.href, loc.href).origin !== loc.origin));
    if (!leaves && !/^(INPUT|SELECT|TEXTAREA|LABEL|OPTION)$/.test(el.tagName))
      watchDead(props, fields);
  }

  let deadPending = false;
  function watchDead(props: Props, fields: Partial<WireEvent>) {
    if (deadPending || typeof win.MutationObserver !== 'function') return;
    deadPending = true;
    const href = loc.href;
    let changed = false;
    const mo = new win.MutationObserver(() => {
      changed = true;
    });
    mo.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    setTimeout(() => {
      mo.disconnect();
      deadPending = false;
      if (!changed && loc.href === href && doc.visibilityState !== 'hidden')
        push('dead_click', props, fields);
    }, DEAD_MS);
  }

  function onScroll() {
    const h = doc.documentElement.scrollHeight;
    if (h <= 0) return;
    const pct = Math.min(100, Math.round(((win.scrollY + win.innerHeight) / h) * 100));
    if (pct > maxScroll) maxScroll = pct;
    for (const d of [25, 50, 75, 100])
      if (pct >= d && !depths.has(d)) {
        depths.add(d);
        push('scroll_depth', {}, { scrollDepth: d });
      }
  }

  const fieldName = (el: Element) =>
    (
      el.getAttribute('name') ||
      el.getAttribute('data-testid') ||
      el.id ||
      el.tagName.toLowerCase()
    ).slice(0, 60);
  const formName = (el: Element) => {
    const f = el.closest('form');
    const n = f && (f.getAttribute('name') || f.getAttribute('data-testid') || f.id);
    return n ? { form: n.slice(0, 60) } : {};
  };
  const reported = new Map<string, number>();
  function formError(el: Element, kind: string) {
    const field = fieldName(el);
    const t = now();
    if (t - (reported.get(field) ?? 0) < 2000) return;
    reported.set(field, t);
    push('form_error', { field, kind, ...formName(el) });
  }

  function onInvalid(e: Event) {
    const el = e.target;
    if (!(el instanceof win.HTMLElement)) return;
    const v = (el as HTMLInputElement).validity;
    const kind = !v
      ? 'invalid'
      : v.valueMissing
        ? 'required'
        : v.patternMismatch
          ? 'pattern'
          : v.typeMismatch
            ? 'type'
            : v.rangeOverflow || v.rangeUnderflow
              ? 'range'
              : v.tooLong || v.tooShort
                ? 'length'
                : 'invalid';
    formError(el, kind);
  }

  function onError(e: ErrorEvent | PromiseRejectionEvent) {
    if (errors >= MAX_ERRORS) return;
    errors++;
    let message: string;
    let extra: Props = {};
    if ('reason' in e) {
      const r: unknown = e.reason;
      message = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
    } else {
      message = e.message || 'Script error';
      let source = '';
      try {
        source = e.filename ? new URL(e.filename).pathname : '';
      } catch {
        // Unparseable source: none.
      }
      extra = {
        ...(source ? { source: source.slice(0, 300) } : {}),
        line: e.lineno || 0,
        col: e.colno || 0,
      };
    }
    push('js_error', { message: cleanMessage(message), ...extra });
  }

  // ───────── web vitals (no dependency: three PerformanceObservers) ─────────

  function observe(type: string, cb: (list: PerformanceEntry[]) => void, extra: object = {}) {
    try {
      const po = new win.PerformanceObserver((l) => cb(l.getEntries()));
      po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      // Entry type unsupported (Safari has no INP/CLS entries).
    }
  }

  function startVitals() {
    if (typeof win.PerformanceObserver !== 'function') return;
    observe('largest-contentful-paint', (es) => {
      const last = es[es.length - 1];
      if (last) vitals.lcp = last.startTime;
    });
    let win5 = 0;
    let first = 0;
    let prev = 0;
    observe('layout-shift', (es) => {
      for (const e of es as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (e.hadRecentInput) continue;
        // Session windows: gap < 1 s, span < 5 s; CLS = the largest window.
        if (win5 && e.startTime - prev < 1000 && e.startTime - first < 5000) win5 += e.value;
        else {
          win5 = e.value;
          first = e.startTime;
        }
        prev = e.startTime;
        if (win5 > vitals.cls) vitals.cls = win5;
      }
    });
    observe(
      'event',
      (es) => {
        for (const e of es as (PerformanceEntry & { interactionId?: number })[])
          if (e.interactionId && e.duration > vitals.inp) vitals.inp = e.duration;
      },
      { durationThreshold: 40 },
    );
  }

  function sendVitals() {
    if (vitals.sent) return;
    vitals.sent = true;
    if (vitals.lcp)
      push('web_vitals', {
        metric: 'LCP',
        value: Math.round(vitals.lcp),
        rating: rating(vitals.lcp, 2500, 4000),
      });
    if (vitals.inp)
      push('web_vitals', {
        metric: 'INP',
        value: Math.round(vitals.inp),
        rating: rating(vitals.inp, 200, 500),
      });
    if (vitals.lcp || vitals.cls)
      push('web_vitals', {
        metric: 'CLS',
        value: Math.round(vitals.cls * 1000) / 1000,
        rating: rating(vitals.cls, 0.1, 0.25),
      });
  }

  // ───────── lifecycle ─────────

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
    [doc, 'click', onClick as EventListener, { capture: true, passive: true }],
    [doc, 'invalid', onInvalid, { capture: true }],
    [win, 'scroll', throttle(onScroll), { passive: true }],
    [win, 'error', onError as EventListener],
    [win, 'unhandledrejection', onError as EventListener],
    [win, 'popstate', onRoute],
    [
      doc,
      'visibilitychange',
      () => {
        if (doc.visibilityState !== 'hidden') return;
        sendVitals();
        flush();
      },
    ],
    [
      win,
      'pagehide',
      () => {
        sendVitals();
        push('exit', { durationMs: Math.min(now() - pageStart, 86_400_000), maxScroll });
        flush();
      },
    ],
  ];
  let ariaObserver: MutationObserver | null = null;

  function throttle(fn: () => void): EventListener {
    let pending = false;
    return () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        fn();
      }, 250);
    };
  }

  function start() {
    if (on) return;
    on = true;
    for (const [t, n, f, o] of listeners) t.addEventListener(n, f, o);
    if (typeof win.MutationObserver === 'function') {
      ariaObserver = new win.MutationObserver((ms) => {
        for (const m of ms)
          if (m.target instanceof win.Element && m.target.getAttribute('aria-invalid') === 'true')
            formError(m.target, 'invalid');
      });
      ariaObserver.observe(doc.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-invalid'],
      });
    }
    startVitals();
    pageView('load');
  }

  function stop() {
    on = false;
    queue = [];
    if (timer) clearTimeout(timer);
    timer = 0;
    for (const [t, n, f, o] of listeners) t.removeEventListener(n, f, o);
    ariaObserver?.disconnect();
    sid = null;
    writeSid(null);
  }

  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = win.history[m];
    win.history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      onRoute();
      return r;
    };
  }

  win.addEventListener('fr:consent', (e) => {
    const c = parseConsent(JSON.stringify((e as CustomEvent<Consent>).detail ?? null));
    if (!c) return;
    consent = c;
    if (!c.analytics) stop();
    else start();
    for (const fn of consentFns) fn(c);
  });

  const api: TrackerApi = {
    sessionId: () => (on ? session() : null),
    consent: () => consent,
    onConsent(fn) {
      consentFns.push(fn);
      return () => void (consentFns.includes(fn) && consentFns.splice(consentFns.indexOf(fn), 1));
    },
    onSession(fn) {
      sessionFns.push(fn);
      if (on && sid) fn(sid);
      return () => void (sessionFns.includes(fn) && sessionFns.splice(sessionFns.indexOf(fn), 1));
    },
    track: (name, props) => push(name, props as Props),
    flush,
  };

  // An explicit "no" to analytics keeps the tracker off (docs/07: essential analytics by default).
  if (consent?.analytics !== false) start();

  // Events fired by the storefront before this script ran (lib/track.ts → window.__frq).
  const w = win as Win & { __frq?: QueueItem[] | { push(i: QueueItem): void } };
  const early = Array.isArray(w.__frq) ? w.__frq : [];
  w.__frq = { push: ([n, p, t]: QueueItem) => push(n, p, undefined, t) };
  for (const [n, p, t] of early) push(n, p, undefined, t);
  return api;
}
