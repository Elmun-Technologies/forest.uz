/**
 * Synthetic storefront traffic (Phase 4 acceptance: "synthetic traffic generates sessions →
 * dashboard numbers match DB truth"). Each session is a fresh browser context (new `fr_aid`)
 * with a deterministic mix of landing source (UTM / click id / referrer), device, pages and
 * commerce steps, driven through the real storefront so the real tracker sends the events.
 *
 *   # from e2e/ (stack running: pnpm dev):
 *   node synthetic/run.mjs --sessions 30 --seed 7 [--orders] [--base http://localhost:3000] [--out m.json]
 *
 *   // from a Playwright spec:
 *   const manifest = await generateTraffic({ browser, baseURL, sessions: 10, seed: 1 });
 *
 * The manifest lists every session id / visitor id with the expected channel, device and steps;
 * compare report numbers with SQL over exactly those ids (`Session.id IN (...)`).
 * Bot filter: contexts use real device UAs and hide `navigator.webdriver` (CLAUDE.md §6).
 */
import { type Browser, type BrowserContext, type Page, chromium, devices } from '@playwright/test';
import { devHeaders } from '../dev-token';

export interface SyntheticOptions {
  browser?: Browser;
  /** Storefront origin. */
  baseURL?: string;
  /** API origin (dev endpoints), for `waitForSessions`. */
  apiURL?: string;
  sessions?: number;
  seed?: number;
  /** Also place COD orders in some checkout sessions (creates customers + 24 h stock holds). */
  orders?: boolean;
  log?: (line: string) => void;
}

export interface SyntheticSession {
  index: number;
  sessionId: string | null;
  anonymousId: string | null;
  device: 'mobile' | 'desktop';
  deviceName: string;
  source: string;
  expectedChannel: string;
  landingUrl: string;
  referrer: string | null;
  /** Page views the generator caused (full loads + client navigations). */
  pageviews: number;
  steps: string[];
  orderNumber: string | null;
}

export interface SyntheticManifest {
  seed: number;
  baseURL: string;
  startedAt: string;
  finishedAt: string;
  sessions: SyntheticSession[];
}

/** mulberry32: small deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Source {
  key: string;
  channel: string;
  query?: string;
  referrer?: string;
}

/** Landing sources and the channel `classifyChannel` must give them (docs/07 rules). */
export const SOURCES: Source[] = [
  { key: 'direct', channel: 'direct' },
  { key: 'google_organic', channel: 'organic_search', referrer: 'https://www.google.com/' },
  { key: 'yandex_organic', channel: 'organic_search', referrer: 'https://yandex.uz/' },
  { key: 'instagram', channel: 'organic_social', referrer: 'https://l.instagram.com/' },
  {
    key: 'telegram_post',
    channel: 'telegram',
    query: 'utm_source=telegram&utm_medium=post&utm_campaign=syn_tg',
  },
  {
    key: 'meta_ads',
    channel: 'paid_meta',
    query: 'utm_source=facebook&utm_medium=cpc&utm_campaign=syn_kuz&fbclid=SYNfb',
  },
  { key: 'google_ads', channel: 'paid_google', query: 'gclid=SYNgclid&utm_campaign=syn_search' },
  { key: 'sms', channel: 'sms', query: 'utm_source=eskiz&utm_medium=sms&utm_campaign=syn_sms' },
  { key: 'blog', channel: 'referral', referrer: 'https://mebel-blog.uz/maqola' },
];

const DEVICES: { name: string; kind: 'mobile' | 'desktop' }[] = [
  { name: 'Pixel 7', kind: 'mobile' },
  { name: 'iPhone 13', kind: 'mobile' },
  { name: 'Galaxy S9+', kind: 'mobile' },
  { name: 'Desktop Chrome', kind: 'desktop' },
  { name: 'Desktop Edge', kind: 'desktop' },
];

const LANDINGS = ['/uz', '/uz/katalog', '/ru', '/ru/katalog', '/uz/qidiruv?q=kraska'];

/**
 * Makes an automated context look like a customer's browser: no `navigator.webdriver`, analytics
 * consent given, the lead popup suppressed.
 */
export async function humanize(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    try {
      sessionStorage.setItem('fr_popup_shown', '1');
    } catch {
      // Opaque origin before the first navigation.
    }
  });
  await context.addCookies([
    {
      name: 'fr_consent',
      value: encodeURIComponent(
        JSON.stringify({ v: 1, analytics: true, marketing: false, replay: false, ts: 1 }),
      ),
      url: baseURL,
    },
  ]);
}

/** Waits until the idle loader has started the tracker. */
export async function trackerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => '__forestTracker' in globalThis, null, { timeout: 20_000 });
}

/** Sends the tracker queue now (instead of waiting for the 5 s timer). */
export async function flushTracker(page: Page): Promise<void> {
  await page.evaluate(() =>
    (globalThis as unknown as { __forestTracker?: { flush(): void } }).__forestTracker?.flush(),
  );
}

export async function trackingIds(
  context: BrowserContext,
): Promise<{ sessionId: string | null; anonymousId: string | null }> {
  const cookies = await context.cookies();
  return {
    sessionId: cookies.find((c) => c.name === 'fr_sid')?.value ?? null,
    anonymousId: cookies.find((c) => c.name === 'fr_aid')?.value ?? null,
  };
}

const pick = <T>(rnd: () => number, list: readonly T[]): T =>
  list[Math.floor(rnd() * list.length)]!;

/**
 * Full page load. The current page's queue is flushed first: Chromium sends beacons of an
 * unloading page with the browser's default (HeadlessChrome) UA instead of the context's device
 * UA, and the ingest drops those as bots. Real browsers are unaffected.
 */
async function goto(page: Page, url: string, referer?: string) {
  if (page.url().startsWith('http')) {
    await flushTracker(page).catch(() => undefined);
    await page.waitForTimeout(150);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', ...(referer ? { referer } : {}) });
}

async function runSession(
  browser: Browser,
  baseURL: string,
  index: number,
  rnd: () => number,
  orders: boolean,
): Promise<SyntheticSession> {
  const source = pick(rnd, SOURCES);
  const dev = pick(rnd, DEVICES);
  const landingPath = pick(rnd, LANDINGS);
  const sep = landingPath.includes('?') ? '&' : '?';
  const landingUrl = `${baseURL}${landingPath}${source.query ? `${sep}${source.query}` : ''}`;
  const ip = `10.${200 + (index % 50)}.${Math.floor(rnd() * 250)}.${1 + Math.floor(rnd() * 250)}`;
  const context = await browser.newContext({
    ...devices[dev.name],
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': ip },
  });
  await humanize(context, baseURL);
  const page = await context.newPage();
  const steps: string[] = [];
  let pageviews = 0;
  let orderNumber: string | null = null;
  const lang = landingPath.startsWith('/ru') ? 'ru' : 'uz';
  try {
    await goto(page, landingUrl, source.referrer);
    pageviews++;
    steps.push(`land:${landingPath}`);
    await trackerReady(page);

    const depth = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < depth; i++) {
      const r = rnd();
      if (r < 0.45) {
        // A product from the catalog API (the same list the cards show).
        const res = await page.request.get(`/api/catalog/products?limit=24`);
        const items = ((await res.json()) as { items: { slug: string; inStock: boolean }[] }).items;
        const p = items.length ? pick(rnd, items) : null;
        if (!p) continue;
        await goto(page, `/${lang}/p/${p.slug}`);
        pageviews++;
        steps.push(`view_item:${p.slug}`);
        await trackerReady(page);
        if (p.inStock && rnd() < 0.5) {
          const add = page.locator('[data-track="add_to_cart"]:visible').first();
          if (await add.isEnabled().catch(() => false)) {
            await add.click();
            await page.waitForTimeout(800);
            steps.push('add_to_cart');
          }
        }
      } else if (r < 0.7) {
        await goto(page, `/${lang}/katalog`);
        pageviews++;
        steps.push('catalog');
        await trackerReady(page);
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(400);
      } else if (r < 0.85) {
        await goto(page, `/${lang}/savat`);
        pageviews++;
        steps.push('cart');
        await trackerReady(page);
      } else {
        await goto(
          page,
          `/${lang}/qidiruv?q=${encodeURIComponent(pick(rnd, ['divan', 'kraska', 'spray']))}`,
        );
        pageviews++;
        steps.push('search');
        await trackerReady(page);
      }
    }
    if (steps.includes('add_to_cart') && rnd() < 0.6) {
      await goto(page, `/${lang}/checkout`);
      pageviews++;
      steps.push('begin_checkout');
      await trackerReady(page);
      if (orders && rnd() < 0.5) orderNumber = await placeCodOrder(page, index);
      if (orderNumber) steps.push(`order:${orderNumber}`);
    }
    await flushTracker(page);
    await page.waitForTimeout(300);
  } catch (e) {
    steps.push(`error:${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const ids = await trackingIds(context);
  await context.close();
  return {
    index,
    ...ids,
    device: dev.kind,
    deviceName: dev.name,
    source: source.key,
    expectedChannel: source.channel,
    landingUrl,
    referrer: source.referrer ?? null,
    pageviews,
    steps,
    orderNumber,
  };
}

async function placeCodOrder(page: Page, index: number): Promise<string | null> {
  const phone = `93${String((Date.now() + index * 7919) % 10_000_000).padStart(7, '0')}`;
  try {
    await page.getByTestId('checkout-phone').fill(phone, { timeout: 10_000 });
    await page.locator('input[name="name"]').fill('Sintetik');
    await page.locator('input[name="addressLine"]').fill("Amir Temur ko'chasi, 15-uy");
    const cod = page.getByTestId('pay-COD');
    if (!(await cod.isEnabled().catch(() => false))) return null;
    await cod.click();
    await page.getByTestId('consent-offer').check();
    const btn = page.locator('[data-track="place_order"]:visible').first();
    await btn.click();
    await page.waitForURL(/\/buyurtma\//, { timeout: 20_000 });
    return page.url().split('/buyurtma/')[1]?.split(/[?#]/)[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateTraffic(opts: SyntheticOptions = {}): Promise<SyntheticManifest> {
  const baseURL = (opts.baseURL ?? process.env.WEB_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const seed = opts.seed ?? 1;
  const rnd = prng(seed);
  const own = !opts.browser;
  // Own browser: a non-headless default UA, so even unload beacons pass the bot filter.
  const browser =
    opts.browser ??
    (await chromium.launch({
      args: [
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ],
    }));
  const startedAt = new Date().toISOString();
  const sessions: SyntheticSession[] = [];
  try {
    for (let i = 0; i < (opts.sessions ?? 10); i++) {
      const s = await runSession(browser, baseURL, i, rnd, opts.orders ?? false);
      opts.log?.(`#${i} ${s.source} ${s.deviceName} → ${s.steps.join(' > ')}`);
      sessions.push(s);
    }
  } finally {
    if (own) await browser.close();
  }
  return { seed, baseURL, startedAt, finishedAt: new Date().toISOString(), sessions };
}

interface StoredSession {
  id: string;
  channel: string;
  device: string;
  pageviews: number;
}

/** Polls the dev endpoint until every manifest session is stored (ingest is async to the page). */
export async function waitForSessions(
  manifest: SyntheticManifest,
  apiURL = process.env.API_URL ?? 'http://localhost:4000',
  timeoutMs = 30_000,
): Promise<Map<string, StoredSession>> {
  const found = new Map<string, StoredSession>();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const s of manifest.sessions) {
      if (!s.sessionId || found.has(s.sessionId)) continue;
      try {
        const res = await fetch(`${apiURL}/v1/dev/events?sessionId=${s.sessionId}`, {
          headers: devHeaders(),
        });
        const body = (await res.json()) as { sessions: StoredSession[] };
        if (body.sessions[0]) found.set(s.sessionId, body.sessions[0]);
      } catch {
        // API restarting (dev watch): retry until the deadline.
      }
    }
    if (found.size === manifest.sessions.filter((s) => s.sessionId).length) return found;
    if (Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
