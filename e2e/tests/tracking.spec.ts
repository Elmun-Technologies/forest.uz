import { expect, test } from '@playwright/test';
import {
  flushTracker,
  generateTraffic,
  humanize,
  trackerReady,
  trackingIds,
  waitForSessions,
} from '../synthetic/traffic';
import { API, devHeaders } from './helpers';

/**
 * First-party tracker end to end (docs/07): the idle-loaded `/t.js` sends page views, list/item
 * views and add_to_cart through `/api/t`, and the API stores them for the browser's session.
 * The context impersonates a customer's browser (real UA, no `navigator.webdriver`) — the
 * ingest drops automation otherwise.
 */
interface StoredEvent {
  name: string;
  path: string;
  props: Record<string, unknown> | null;
  selector: string | null;
}

async function stored(sessionId: string): Promise<{
  sessions: { channel: string; device: string; landingPath: string; pageviews: number }[];
  events: StoredEvent[];
}> {
  const res = await fetch(`${API}/v1/dev/events?sessionId=${sessionId}`, {
    headers: devHeaders(),
  });
  return (await res.json()) as Awaited<ReturnType<typeof stored>>;
}

test.describe('tracker', () => {
  test('browse → product → add to cart: events arrive for the session @smoke', async ({
    browser,
    baseURL,
    isMobile,
  }, testInfo) => {
    // Dev servers compile routes on first hit (and the synthetic test may run in parallel).
    test.setTimeout(90_000);
    const device = testInfo.project.use;
    const context = await browser.newContext({ ...device, baseURL });
    await humanize(context, baseURL ?? 'http://localhost:3000');
    const page = await context.newPage();

    await page.goto('/uz/katalog?utm_source=telegram&utm_medium=post&utm_campaign=e2e_trk');
    await trackerReady(page);
    await expect(page.locator('script[data-forest-tracker]')).toHaveAttribute('src', /\/t\.js\?v=/);

    const list = (await (await page.request.get(`${API}/v1/catalog/products?limit=60`)).json()) as {
      items: { slug: string; inStock: boolean; defaultVariantId: string | null }[];
    };
    const product = list.items.find((p) => p.inStock && p.defaultVariantId);
    expect(product, 'an in-stock product').toBeTruthy();
    await flushTracker(page);
    await page.goto(`/uz/p/${product!.slug}`);
    await trackerReady(page);
    // A click before hydration does nothing (dev servers hydrate slowly): retry until it lands.
    await expect(async () => {
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/cart/items') && r.ok(), {
          timeout: 5_000,
        }),
        page.locator('[data-track="add_to_cart"]:visible').first().click(),
      ]);
    }).toPass({ timeout: 45_000 });
    await flushTracker(page);

    const { sessionId, anonymousId } = await trackingIds(context);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(anonymousId, 'fr_aid issued by the storefront').toBeTruthy();

    let body = await stored(sessionId!);
    await expect
      .poll(
        async () => {
          body = await stored(sessionId!);
          return body.events.map((e) => e.name);
        },
        { timeout: 20_000 },
      )
      .toEqual(expect.arrayContaining(['page_view', 'view_item_list', 'view_item', 'add_to_cart']));

    expect(body.sessions[0]).toMatchObject({
      channel: 'telegram',
      device: isMobile ? 'mobile' : 'desktop',
      landingPath: '/uz/katalog',
    });
    const add = body.events.find((e) => e.name === 'add_to_cart')!;
    expect(add.props).toMatchObject({ qty: 1, list: 'product' });
    expect(body.events.some((e) => e.name === 'click' && e.selector)).toBe(true);
    // No PII and no query strings in stored paths/props.
    const text = JSON.stringify(
      body.events.map((e) => ({ path: e.path, props: e.props, selector: e.selector })),
    );
    expect(text).not.toMatch(/(?:\+?\d[\s\-().]*){9,}/);
    expect(body.events.every((e) => !e.path.includes('?'))).toBe(true);
    await context.close();
  });

  test('synthetic traffic: every session stored with the expected channel and device', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'generator picks its own devices');
    test.setTimeout(240_000);
    const manifest = await generateTraffic({ browser, baseURL, sessions: 6, seed: 42 });
    const sessions = await waitForSessions(manifest, API);
    const ok = manifest.sessions.filter((s) => !s.steps.some((x) => x.startsWith('error:')));
    expect(ok.length).toBeGreaterThan(3);
    for (const s of ok) {
      const row = sessions.get(s.sessionId ?? '');
      expect(row, `session #${s.index} stored`).toBeTruthy();
      expect(row, `#${s.index} ${s.source}`).toMatchObject({
        channel: s.expectedChannel,
        device: s.device,
      });
    }
  });
});
