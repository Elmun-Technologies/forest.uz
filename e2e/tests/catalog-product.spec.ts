import { expect, type Page, test } from '@playwright/test';

const PLACEHOLDER = /\[[^\]\n]{1,40}\]/;

async function noPlaceholders(page: Page) {
  expect(await page.locator('body').innerText()).not.toMatch(PLACEHOLDER);
}

/** Pre-answer the cookie banner and suppress the exit popup so overlays don't cover the flow. */
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'fr_consent',
      value: encodeURIComponent(JSON.stringify({ v: 1, analytics: true, marketing: false, ts: 1 })),
      url: baseURL ?? 'http://localhost:3000',
    },
  ]);
  await context.addInitScript(() => sessionStorage.setItem('fr_popup_shown', '1'));
});

test.describe('storefront: home → catalog → product', () => {
  test('browse, filter by colour and volume, open product, use calculator, pick variant', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/uz');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('bestsellers').locator('> li').first()).toBeVisible();
    await noPlaceholders(page);

    await page.goto('/uz/katalog');
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    await noPlaceholders(page);

    // Filters live in the aside on desktop and in a bottom sheet on mobile.
    const scope = isMobile ? page.getByRole('dialog') : page.getByRole('complementary');
    if (isMobile) await page.getByTestId('open-filters').click();
    await scope.locator('[data-testid^="color-"]').first().click();
    await expect(page).toHaveURL(/[?&]color=[0-9a-f]{6}/);
    if (isMobile && !(await scope.isVisible())) await page.getByTestId('open-filters').click();
    await scope.locator('[data-testid^="volume-"]').first().click();
    await expect(page).toHaveURL(/[?&]volume=\d+/);
    await expect(page).toHaveURL(/color=/);
    if (isMobile) await page.keyboard.press('Escape');

    // Filtered pages are noindex,follow with a canonical to the base catalog.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // After a client-side navigation Next may briefly keep the previous head tag; check the newest.
    await expect(page.locator('link[rel="canonical"]').last()).toHaveAttribute(
      'href',
      /\/uz\/katalog$/,
    );

    const card = page.getByTestId('product-card').first();
    await expect(card).toBeVisible();
    await card.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/uz\/p\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noPlaceholders(page);

    // Paint product with a calculator and volume variants.
    await page.goto('/uz/p/chalk-white');
    const calc = page.getByTestId('calculator');
    await calc.getByRole('button', { name: /Shkaf/ }).click();
    await expect(calc.getByTestId('calc-liters')).toHaveText('1,5');
    await expect(calc.getByTestId('calc-recommendation')).toContainText('L');
    await noPlaceholders(page);

    const variant = page.getByRole('button', { name: /^2,5 L/ });
    await variant.click();
    await expect(variant).toHaveAttribute('aria-pressed', 'true');
    const priceScope = isMobile ? page.getByTestId('mobile-buy-bar') : page.locator('main');
    await expect(priceScope.getByText(/749 000/).first()).toBeVisible();
  });

  test('product JSON-LD and delivery promise', async ({ page }) => {
    await page.goto('/uz/p/chalk-white');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = ld
      .map((s) => JSON.parse(s) as { '@type': string })
      .find((d) => d['@type'] === 'Product');
    expect(product).toBeTruthy();
    expect(JSON.stringify(product)).not.toContain('aggregateRating');
    await expect(page.locator('[data-testid^="delivery-promise"]:visible')).toHaveText(
      /(bugun|ertaga) \d{2}:\d{2} gacha/,
    );
  });

  test('quick add from the catalog updates the cart count', async ({ page, isMobile }) => {
    await page.goto('/uz/katalog');
    const add = page
      .getByTestId('product-card')
      .first()
      .locator('[data-track="add_to_cart"]:visible')
      .first();
    await add.click();
    if (isMobile) await expect(page.getByTestId('mobile-cart-bar')).toContainText('1');
    else await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('RU pages render Cyrillic copy', async ({ page }) => {
    for (const path of ['/ru', '/ru/katalog', '/ru/p/chalk-white']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/[А-Яа-яЁё]{4,}/);
      expect(text).not.toMatch(PLACEHOLDER);
    }
    await page.goto('/ru/katalog');
    await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeAttached();
  });

  test('language switch keeps the current path and query', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop header switch; mobile uses the menu sheet');
    await page.goto('/uz/katalog?sort=price_asc');
    await page
      .getByRole('navigation', { name: 'Tilni tanlash' })
      .getByRole('link', { name: 'Русский' })
      .click();
    await expect(page).toHaveURL(/\/ru\/katalog\?sort=price_asc$/);
  });
});
