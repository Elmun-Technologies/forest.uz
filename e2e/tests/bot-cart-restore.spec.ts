import { expect, test } from '@playwright/test';
import { addToCart, API, quietOverlays } from './helpers';

/**
 * Phase 5 acceptance "bot deep links restore cart" (CLAUDE.md §6, 5A): a cart restore link opened
 * in another browser (the customer's phone, from Telegram) brings the lines and the code back and
 * opens checkout; a broken link lands on the cart page.
 */
test.describe('bot cart restore link', () => {
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

    // Opening the link again changes nothing (qty = max, not +2).
    await phone.goto(link.pathname);
    const again = (await (await phone.request.get('/api/cart')).json()) as {
      lines: { qty: number }[];
    };
    expect(again.lines.map((l) => l.qty)).toEqual([2]);
    await other.close();
  });

  test('a broken link opens the cart page', async ({ page, baseURL }) => {
    await quietOverlays(page.context(), baseURL);
    await page.goto('/c/eyJlIjoxfQ.bad-signature-bad-signature-bad00');
    await expect(page).toHaveURL(/\/(uz|ru)\/savat$/);
  });
});
