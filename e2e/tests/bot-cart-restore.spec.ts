import { expect, test } from '@playwright/test';
import { addToCart, API, devHeaders, quietOverlays } from './helpers';

/**
 * Phase 5 acceptance "bot deep links restore cart" (CLAUDE.md §6, 5A): a cart restore link opened
 * in another browser (the customer's phone, from Telegram) brings the lines and the code back and
 * opens checkout; a broken link lands on the cart page.
 */
test.describe('bot cart restore link', () => {
  // Dev servers compile routes on first use.
  test.describe.configure({ timeout: 120_000 });

  test('restores the cart with SAVAT5 in a fresh browser and opens checkout', async ({
    page,
    browser,
    baseURL,
  }) => {
    await quietOverlays(page.context(), baseURL);
    await page.goto('/uz');
    await addToCart(page, 2);
    const cartId = (await page.context().cookies()).find((c) => c.name === 'fr_cart')?.value;
    expect(cartId, 'cart cookie').toBeTruthy();

    const minted = await page.request.post(`${API}/v1/dev/bot/cart-link`, {
      data: { cartId, promo: 'SAVAT5', locale: 'ru' },
      headers: devHeaders(),
    });
    expect(minted.ok()).toBe(true);
    const link = new URL(((await minted.json()) as { url: string }).url);
    expect(link.pathname).toMatch(/^\/c\/[\w-]+\.[\w-]+$/);

    const other = await browser.newContext();
    await quietOverlays(other, baseURL);
    const phone = await other.newPage();
    await phone.goto(link.pathname);
    await expect(phone).toHaveURL(/\/ru\/checkout\?utm_source=telegram&utm_medium=bot/);
    const cart = (await (await phone.request.get('/api/cart')).json()) as {
      id: string;
      lines: { qty: number }[];
      promo: { code: string } | null;
    };
    expect(cart.id).not.toBe(cartId);
    expect(cart.lines.map((l) => l.qty)).toEqual([2]);
    expect(cart.promo?.code).toBe('SAVAT5');

    // Opening the link again (another tap) changes nothing (qty = max, not +2).
    const tap = await other.newPage();
    await tap.goto(link.pathname);
    await expect(tap).toHaveURL(/\/ru\/checkout/);
    const again = (await (await tap.request.get('/api/cart')).json()) as {
      lines: { qty: number }[];
    };
    expect(again.lines.map((l) => l.qty)).toEqual([2]);
    await other.close();
  });

  test('a non-navigation request gets a confirm page and changes nothing', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await quietOverlays(page.context(), baseURL);
    await page.goto('/uz');
    await addToCart(page, 1);
    const cartId = (await page.context().cookies()).find((c) => c.name === 'fr_cart')?.value;
    const minted = await page.request.post(`${API}/v1/dev/bot/cart-link`, {
      data: { cartId },
      headers: devHeaders(),
    });
    const path = new URL(((await minted.json()) as { url: string }).url).pathname;

    // Link-preview robots / cross-site <img>: no Fetch Metadata navigation → confirm page only.
    const bot = await playwright.request.newContext({ baseURL });
    const preview = await bot.get(path, { maxRedirects: 0 });
    expect(preview.status()).toBe(200);
    expect(await preview.text()).toContain('method="post"');
    expect(preview.headers()['set-cookie'] ?? '').not.toContain('fr_cart');
    // A cross-site form post is refused.
    const forged = await bot.post(path, {
      maxRedirects: 0,
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(forged.status()).toBe(403);
    await bot.dispose();
  });

  test('a broken link opens the cart page', async ({ page, baseURL }) => {
    await quietOverlays(page.context(), baseURL);
    await page.goto('/c/eyJlIjoxfQ.bad-signature-bad-signature-bad00');
    await expect(page).toHaveURL(/\/(uz|ru)\/savat$/);
  });
});
