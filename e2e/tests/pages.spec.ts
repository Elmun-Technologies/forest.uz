import { expect, test } from '@playwright/test';
import {
  addToCart,
  fillCheckout,
  noPlaceholders,
  placeOrder,
  quietOverlays,
  spreadClientIp,
  uniquePhone,
} from './helpers';

/** Navigations may hit a first-time route compile on the dev server. */
const NAV = { timeout: 20_000 };

test.beforeEach(async ({ context, baseURL }) => {
  await quietOverlays(context, baseURL);
  await spreadClientIp(context);
});

test.describe('RU locale', () => {
  test('cart, checkout, order and tracking work in Russian', async ({
    page,
    isMobile,
    browser,
  }) => {
    test.slow();
    test.slow();
    await page.goto('/ru/savat');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByTestId('cart-empty')).toContainText('Корзина пока пуста');
    await addToCart(page, 2);
    await page.goto('/ru/savat');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await page.getByTestId('promo-input').fill('NOPE99');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByTestId('promo-message')).toContainText('Промокод не найден');

    await page.goto('/ru/checkout');
    await expect(page.getByText(isMobile ? '1 · Контакты' : 'Контактные данные')).toBeVisible();
    await fillCheckout(page, { phone: uniquePhone(), method: 'COD', name: 'Ольга' });
    await placeOrder(page, isMobile);
    await expect(page).toHaveURL(/\/ru\/buyurtma\//, NAV);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Спасибо, Ольга!');
    await expect(page.getByTestId('order-timeline')).toContainText('Принят');
    await noPlaceholders(page);

    const href = await page.getByTestId('tracking-link').getAttribute('href');
    // The short link has no locale: the language comes from the fr_locale cookie set on /ru.
    await page.goto(href!);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Заказ #F-');

    // A fresh device (no language cookie, Uzbek browser) opens the SMS link in the order's language.
    const other = await browser.newContext({
      locale: 'uz-UZ',
      extraHTTPHeaders: { 'Accept-Language': 'uz' },
    });
    const fresh = await other.newPage();
    await fresh.goto(href!);
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'ru');
    await other.close();
  });
});

test.describe('legal, edge states and SEO', () => {
  const legal = ['oferta', 'maxfiylik', 'qaytarish', 'yetkazish-tolov'];

  for (const locale of ['uz', 'ru'] as const) {
    test(`legal pages render with the draft notice and no placeholders (${locale})`, async ({
      page,
    }) => {
      test.slow();
      for (const slug of legal) {
        const res = await page.goto(`/${locale}/${slug}`);
        expect(res?.status()).toBe(200);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId('legal-draft')).toBeVisible();
        await expect(page.getByRole('navigation', { name: /Hujjatlar|Документы/ })).toBeVisible();
        await expect(page.locator('link[rel="alternate"][hreflang="ru"]')).toHaveAttribute(
          'href',
          new RegExp(`/ru/${slug}$`),
        );
        await noPlaceholders(page);
      }
      await page.goto(`/${locale}/yetkazish-tolov`);
      await expect(page.getByTestId('delivery-zones').locator('tbody tr').first()).toBeVisible();
    });
  }

  test('404 page offers search, home and catalog; unknown product is a real 404', async ({
    page,
  }) => {
    const res = await page.goto('/uz/bunday-sahifa-yoq');
    expect(res?.status()).toBe(404);
    const nf = page.getByTestId('not-found');
    await expect(nf).toContainText("bo'yalib ketganga o'xshaydi");
    await expect(nf.getByRole('searchbox')).toBeVisible();
    await expect(nf.getByRole('link', { name: 'Katalog' })).toBeVisible();
    expect((await page.goto('/uz/p/bunday-mahsulot-yoq'))?.status()).toBe(404);
    expect((await page.goto('/t/ZZZZZZZZZZ'))?.status()).toBe(404);
    await noPlaceholders(page);
  });

  test('empty search and empty cart give a way forward', async ({ page }) => {
    await page.goto('/uz/qidiruv?q=zzzzqqq');
    await expect(page.getByText('hech narsa topilmadi')).toBeVisible();
    await expect(page.getByRole('link', { name: "Katalogga o'tish" }).first()).toBeVisible();
    await page.goto('/uz/savat');
    const empty = page.getByTestId('cart-empty');
    await expect(empty).toContainText("Savat hozircha bo'sh");
    await expect(empty.getByRole('link', { name: /Katalogga/ })).toBeVisible();
  });

  test('fake payment page refuses unknown orders', async ({ page }) => {
    expect((await page.goto('/uz/fake-pay?order=does-not-exist'))?.status()).toBe(404);
  });

  test('robots.txt and sitemap.xml', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /uz/checkout');
    expect(robots).toContain('Disallow: /t/');
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
    // Sitemap index (A9) → per locale × type files.
    const res = await request.get('/sitemap.xml');
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain('/sitemaps/uz-products.xml</loc>');
    const products = await (await request.get('/sitemaps/uz-products.xml')).text();
    expect(products).toContain('/uz/p/chalk-white</loc>');
    expect(products).toContain('hreflang="x-default"');
    const pages = await (await request.get('/sitemaps/ru-pages.xml')).text();
    expect(pages).toContain('/ru/oferta</loc>');
    expect(pages).not.toContain('/savat');
  });

  test('private pages are noindex', async ({ page }) => {
    for (const path of ['/uz/savat', '/uz/checkout', '/uz/kirish']) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });

  test('no page renders [placeholder] brackets', async ({ page, isMobile }) => {
    test.slow();
    test.slow();
    await page.goto('/uz');
    await addToCart(page);
    for (const path of [
      '/uz',
      '/ru',
      '/uz/katalog',
      '/uz/p/chalk-white',
      '/ru/p/divan-yangilash-toplami',
      '/uz/savat',
      '/ru/savat',
      '/uz/checkout',
      '/uz/kirish',
      '/ru/kirish',
    ]) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await noPlaceholders(page);
    }
    await page.goto('/uz/checkout');
    await fillCheckout(page, { phone: uniquePhone(), method: 'COD' });
    await placeOrder(page, isMobile);
    await expect(page).toHaveURL(/\/uz\/buyurtma\//, NAV);
    await noPlaceholders(page);
  });
});
