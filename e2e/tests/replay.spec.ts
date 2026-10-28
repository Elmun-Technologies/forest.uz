import { expect, type Response, test } from '@playwright/test';
import { ownerContext } from './admin-helpers';
import { addToCart } from './helpers';

/**
 * Phase 4 acceptance "replay plays with masked inputs": a visitor who allowed session recording
 * types personal data on checkout; the chunks reach the API; the admin player opens the session
 * and neither the stored events nor the replayed DOM contain what was typed.
 */
const NAME = 'Zafarbek Qwzxyev';
const PHONE = '937776655';
const ADDRESS = 'Qatortol Xq9z kochasi 77';
const SECRETS = ['Zafarbek', 'Qwzxyev', '7776655', '777 66 55', 'Xq9z'];

test('session replay: consented checkout typing is recorded masked and plays in admin', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough for the round trip');
  test.setTimeout(240_000); // cold dev compiles of checkout, /r.js and the admin page

  // A visitor with analytics + recording consent (real UA; automation flag hidden like the
  // synthetic traffic, or the ingest drops the session as a bot).
  const shop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await shop.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    sessionStorage.setItem('fr_popup_shown', '1');
  });
  await shop.addCookies([
    {
      name: 'fr_consent',
      value: encodeURIComponent(
        JSON.stringify({ v: 1, analytics: true, marketing: false, replay: true, ts: Date.now() }),
      ),
      url: baseURL ?? 'http://localhost:3000',
    },
  ]);
  const page = await shop.newPage();
  const stored: Response[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/t/replay') && r.status() === 201) stored.push(r);
  });

  await addToCart(page);
  await page.goto('/uz/checkout');
  await expect(page.getByTestId('checkout-phone')).toBeVisible({ timeout: 20_000 });
  // Checkout sessions are recorded at `replayCheckoutPct` (100 % by default).
  const sid = await page
    .waitForFunction(
      () =>
        (
          globalThis as unknown as { __forestReplay?: { sessionId(): string | null } }
        ).__forestReplay?.sessionId() ?? null,
      undefined,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue() as Promise<string>);
  expect(sid).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByLabel(/^(Ism|Имя)$/).pressSequentially(NAME, { delay: 15 });
  await page.getByTestId('checkout-phone').pressSequentially(PHONE, { delay: 15 });
  await page.getByLabel(/^(Manzil|Адрес)$/).pressSequentially(ADDRESS, { delay: 10 });
  const before = stored.length;
  // The next 10 s chunk carries the typing (a 409 "session not ingested yet" is retried).
  await expect.poll(() => stored.length, { timeout: 45_000 }).toBeGreaterThan(before);
  await shop.close();

  // Admin (owner session): open the recording.
  const { ctx, page: admin } = await ownerContext(browser);
  // Dev servers recompile on first visit: reload until the player's audited POST answers.
  let res: Response | undefined;
  await expect(async () => {
    const opened = admin.waitForResponse(
      (r) => r.url().includes(`/api/admin/replays/${sid}/open`) && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await admin.goto(`/heatmaps?session=${sid}`);
    res = await opened;
  }).toPass({ timeout: 90_000 });
  if (!res) throw new Error('replay was not opened');
  expect(res.status()).toBe(201);
  const raw = await res.text();
  expect(raw).toContain('"events"');
  for (const s of SECRETS) expect(raw).not.toContain(s);

  const player = admin.getByTestId('replay-player');
  await expect(player).toBeVisible();
  await expect(player.getByText('Kiritish maydonlari va shaxsiy matnlar')).toBeVisible();
  const frame = admin.frameLocator('[data-testid="replay-stage"] iframe');
  // The replayed checkout form exists…
  await expect(frame.locator('input[name="name"]')).toHaveCount(1, { timeout: 20_000 });
  // …let it play through the typing, then check every input value and the whole DOM.
  await admin.waitForTimeout(6_000);
  const dom = await frame.locator('html').evaluate((el) => {
    const values = Array.from(el.querySelectorAll('input, textarea')).map(
      (i) => (i as unknown as { value: string }).value,
    );
    return { html: el.outerHTML, values };
  });
  for (const s of SECRETS) {
    expect(dom.html).not.toContain(s);
    for (const v of dom.values) expect(v).not.toContain(s);
  }
  await ctx.close();
});
