import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM, CookieJar } from 'jsdom';
import { cleanMessage, cssPath, install, parseConsent, uuid7 } from './core';

type Win = Window & typeof globalThis;
interface Sent {
  v: number;
  sid: string;
  now: number;
  wd: boolean;
  events: {
    id: string;
    name: string;
    t: number;
    path: string;
    props?: Record<string, unknown>;
    selector?: string;
    x?: number;
    viewportW?: number;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let sent: Sent[] = [];
let blobs: Promise<void>[] = [];
let jar: CookieJar;

/** A fresh page (own window, listeners) sharing the cookie jar, like a new page load. */
function page(path = '/uz', body = ''): { w: Win; t: ReturnType<typeof install> } {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: `https://forest.uz${path}`,
    cookieJar: jar,
  });
  const w = dom.window as unknown as Win;
  Object.defineProperty(w.navigator, 'sendBeacon', {
    configurable: true,
    value: (_url: string, data: Blob) => {
      blobs.push(data.text().then((text) => void sent.push(JSON.parse(text) as Sent)));
      return true;
    },
  });
  return { w, t: install(w) };
}

async function drain(): Promise<Sent[]> {
  await Promise.all(blobs);
  blobs = [];
  const out = sent;
  sent = [];
  return out;
}

const names = (batches: Sent[]) => batches.flatMap((b) => b.events.map((e) => e.name));
const events = (batches: Sent[]) => batches.flatMap((b) => b.events);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
  sent = [];
  blobs = [];
  jar = new CookieJar();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('helpers', () => {
  it('uuid7 is a time-ordered v7 uuid', () => {
    const a = uuid7(1_000, crypto);
    const b = uuid7(2_000, crypto);
    expect(a).toMatch(UUID);
    expect(a < b).toBe(true);
  });

  it('cssPath: id anchor, nth-of-type steps, skips React ids', () => {
    const { w } = page(
      '/uz',
      '<main id="main"><section><a>1</a><a id=":r1:"><span>x</span></a></section></main>',
    );
    expect(cssPath(w.document.querySelector('span')!)).toBe('#main>section>a:nth-of-type(2)>span');
  });

  it('cleanMessage drops query strings of URLs', () => {
    expect(cleanMessage('failed https://x.uz/a.js?token=abc at 1')).toBe(
      'failed https://x.uz/a.js at 1',
    );
  });

  it('parseConsent', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('garbage')).toBeNull();
    expect(parseConsent(encodeURIComponent('{"v":1,"analytics":false,"marketing":true}'))).toEqual({
      analytics: false,
      marketing: true,
      replay: false,
    });
  });
});

describe('tracker', () => {
  it('sends a landing page_view with utm, click ids and a fresh session', async () => {
    const { w, t } = page('/uz/p/divan?utm_source=fb&utm_campaign=kuz&fbclid=F1&x=1');
    t.flush();
    const [batch] = await drain();
    expect(batch!.sid).toMatch(UUID);
    expect(batch!.wd).toBe(false);
    expect(w.document.cookie).toContain(`fr_sid=${batch!.sid}`);
    expect(batch!.events[0]).toMatchObject({
      name: 'page_view',
      path: '/uz/p/divan',
      props: {
        landing: true,
        nav: 'load',
        locale: 'uz',
        utm: { source: 'fb', campaign: 'kuz' },
        clickIds: { fbclid: 'F1' },
      },
    });
    expect(t.sessionId()).toBe(batch!.sid);
  });

  it('flushes after 5 s or at 20 events, one session per batch', async () => {
    const { t } = page();
    t.track('view_item', { productId: 'p1' });
    expect(blobs).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(names(await drain())).toEqual(['page_view', 'view_item']);
    for (let i = 0; i < 20; i++) t.track('select_variant', { variantId: `v${i}` });
    const batches = await drain();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.events).toHaveLength(20);
  });

  it('flushes on visibilitychange → hidden and sends exit on pagehide', async () => {
    const { w } = page();
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, value: 'hidden' });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    expect(names(await drain())).toEqual(['page_view']);
    w.dispatchEvent(new w.Event('pagehide'));
    expect(names(await drain())).toEqual(['exit']);
  });

  it('keeps the session across page loads, rotates after 30 min idle and on a new campaign', async () => {
    page().t.flush();
    const first = (await drain())[0]!.sid;

    // Next page load within 30 min: same session, no landing context.
    page('/uz/katalog').t.flush();
    const second = (await drain())[0]!;
    expect(second.sid).toBe(first);
    expect(second.events[0]!.props).not.toHaveProperty('landing');

    // Landing with a new utm_campaign → new session.
    const third = page('/uz?utm_source=tg&utm_campaign=new');
    third.t.flush();
    const thirdSid = (await drain())[0]!.sid;
    expect(thirdSid).not.toBe(first);

    // 30 min without events: the cookie expires → the next event starts a new session there.
    vi.advanceTimersByTime(31 * 60_000);
    third.t.track('search', { q: 'divan', results: 2 });
    third.t.flush();
    const fourth = (await drain()).at(-1)!;
    expect(fourth.sid).not.toBe(thirdSid);
    expect(fourth.events.map((e) => [e.name, e.props?.landing])).toEqual([
      ['page_view', true],
      ['search', undefined],
    ]);
  });

  it('SPA navigation sends page_view only when the path changes', async () => {
    const { w, t } = page();
    w.history.pushState(null, '', '/uz/katalog?sort=price');
    vi.advanceTimersByTime(1);
    w.history.replaceState({ next: true }, '', '/uz/katalog?sort=new');
    vi.advanceTimersByTime(1);
    t.flush();
    expect(events(await drain()).map((e) => [e.name, e.path, e.props?.nav])).toEqual([
      ['page_view', '/uz', 'load'],
      ['page_view', '/uz/katalog', 'spa'],
    ]);
  });

  it('masks capability paths', async () => {
    page('/uz/t/SecretTok123').t.flush();
    expect(events(await drain())[0]!.path).toBe('/uz/t/:token');
  });

  it('click: selector, x‰, y, viewport; data-track goals; rage click', async () => {
    const { w, t } = page(
      '/uz',
      '<main id="m"><a href="https://t.me/forest" data-track="telegram_click">tg</a><button>b</button></main>',
    );
    w.document
      .querySelector('a')!
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    const btn = w.document.querySelector('button')!;
    for (let i = 0; i < 3; i++)
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    t.flush();
    const evs = events(await drain());
    expect(evs.map((e) => e.name)).toEqual([
      'page_view',
      'click',
      'telegram_click',
      'click',
      'click',
      'click',
      'rage_click',
    ]);
    expect(evs[1]).toMatchObject({
      selector: '#m>a',
      props: { tag: 'a', track: 'telegram_click' },
    });
    expect(evs[1]!.x).toBeGreaterThanOrEqual(0);
    expect(evs[1]!.viewportW).toBe(w.innerWidth);
    expect(evs[6]!.props).toMatchObject({ count: 3, tag: 'button' });
  });

  it('dead click: nothing changed within 1 s', async () => {
    const { w, t } = page('/uz', '<div><span id="s">static</span><button id="b">ok</button></div>');
    w.document.getElementById('s')!.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    // A click that changes the DOM is not dead.
    const b = w.document.getElementById('b')!;
    b.addEventListener('click', () => b.setAttribute('aria-pressed', 'true'));
    b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    t.flush();
    const dead = events(await drain()).filter((e) => e.name === 'dead_click');
    expect(dead.map((e) => e.selector)).toEqual(['#s']);
  });

  it('form_error records the field name only, never the value', async () => {
    const { w, t } = page(
      '/uz/checkout',
      '<form data-testid="checkout"><input name="phone" value="901234567"></form>',
    );
    w.document.querySelector('input')!.setAttribute('aria-invalid', 'true');
    await vi.advanceTimersByTimeAsync(0);
    t.flush();
    const batches = await drain();
    const ev = events(batches).find((e) => e.name === 'form_error')!;
    expect(ev.props).toEqual({ field: 'phone', kind: 'invalid', form: 'checkout' });
    expect(JSON.stringify(batches)).not.toContain('901234567');
  });

  it('js_error: message without URL queries, at most 5 per page', async () => {
    const { w, t } = page();
    for (let i = 0; i < 7; i++)
      w.dispatchEvent(
        new w.ErrorEvent('error', {
          message: `boom https://forest.uz/x.js?k=${i}`,
          filename: 'https://forest.uz/_next/x.js?v=1',
          lineno: 3,
        }),
      );
    t.flush();
    const errs = events(await drain()).filter((e) => e.name === 'js_error');
    expect(errs).toHaveLength(5);
    expect(errs[0]!.props).toEqual({
      message: 'boom https://forest.uz/x.js',
      source: '/_next/x.js',
      line: 3,
      col: 0,
    });
  });

  it('scroll depth thresholds once per page', async () => {
    const { w, t } = page();
    Object.defineProperty(w.document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(w, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(w, 'scrollY', { configurable: true, value: 800 });
    w.dispatchEvent(new w.Event('scroll'));
    vi.advanceTimersByTime(300);
    w.dispatchEvent(new w.Event('scroll'));
    vi.advanceTimersByTime(300);
    t.flush();
    expect(
      events(await drain())
        .filter((e) => e.name === 'scroll_depth')
        .map((e) => (e as { scrollDepth?: number }).scrollDepth),
    ).toEqual([25, 50, 75]);
  });

  it('early events from window.__frq are sent; later pushes go straight in', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://forest.uz/uz' });
    const w = dom.window as unknown as Win & { __frq: unknown };
    w.__frq = [['view_cart', { itemsCount: 1, valueSoum: 5 }, Date.now()]];
    Object.defineProperty(w.navigator, 'sendBeacon', {
      value: (_u: string, d: Blob) => {
        blobs.push(d.text().then((x) => void sent.push(JSON.parse(x) as Sent)));
        return true;
      },
    });
    const t = install(w);
    (w.__frq as { push(i: unknown): void }).push([
      'begin_checkout',
      { itemsCount: 1, valueSoum: 5 },
    ]);
    t.flush();
    expect(names(await drain())).toEqual(['page_view', 'view_cart', 'begin_checkout']);
  });

  it('an explicit analytics opt-out keeps it off; consent changes stop/start it', async () => {
    jar.setCookieSync(
      `fr_consent=${encodeURIComponent('{"v":1,"analytics":false,"marketing":false}')}; Path=/`,
      'https://forest.uz/',
    );
    const { w, t } = page();
    t.track('view_item', { productId: 'p' });
    t.flush();
    expect(await drain()).toHaveLength(0);
    expect(t.sessionId()).toBeNull();

    const seen: unknown[] = [];
    t.onConsent((c) => seen.push(c));
    w.dispatchEvent(
      new w.CustomEvent('fr:consent', {
        detail: { v: 1, analytics: true, marketing: false, replay: true },
      }),
    );
    t.flush();
    expect(names(await drain())).toEqual(['page_view']);
    expect(seen).toEqual([{ analytics: true, marketing: false, replay: true }]);

    w.dispatchEvent(
      new w.CustomEvent('fr:consent', { detail: { v: 1, analytics: false, marketing: false } }),
    );
    expect(w.document.cookie).not.toContain('fr_sid=');
    expect(t.sessionId()).toBeNull();
  });

  it('onSession reports the current and every new session', () => {
    const { t } = page();
    const ids: string[] = [];
    t.onSession((id) => ids.push(id));
    vi.advanceTimersByTime(31 * 60_000);
    t.track('search', { q: 'x', results: 0 });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reports navigator.webdriver', async () => {
    const { w, t } = page();
    Object.defineProperty(w.navigator, 'webdriver', { configurable: true, value: true });
    t.flush();
    expect((await drain())[0]!.wd).toBe(true);
  });
});
