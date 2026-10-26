import { expect, test } from '@playwright/test';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';

test.describe('@smoke foundation', () => {
  test('api is ready and serves seeded catalog', async ({ request }) => {
    expect((await request.get(`${API}/ready`)).ok()).toBe(true);
    const res = await request.get(`${API}/v1/catalog/products`);
    expect(res.ok()).toBe(true);
    expect((await res.json()).total).toBeGreaterThanOrEqual(8);
  });

  test('root redirects by Accept-Language', async ({ browser }) => {
    const ctx = await browser.newContext({
      locale: 'ru-RU',
      extraHTTPHeaders: { 'Accept-Language': 'ru-RU,ru;q=0.9' },
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/ru$/);
    await ctx.close();
  });

  for (const locale of ['uz', 'ru'] as const) {
    test(`storefront renders seeded bestsellers (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('bestsellers').locator('> li')).toHaveCount(4);
      // Design placeholders must never reach the page.
      expect(await page.locator('body').innerText()).not.toMatch(/\[[^\]\n]{1,40}\]/);
    });
  }

  test('admin shell boots and reaches the api', async ({ page }) => {
    await page.goto(ADMIN);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('ulangan')).toBeVisible();
  });
});
