import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ADMIN, ownerContext, spreadAdminIp } from './admin-helpers';

/**
 * SEO center A9 (desktop): the owner edits a product's SEO title → the storefront `<title>` changes
 * at once (on-demand revalidation, not the ISR window); a verification code appears in `<head>`;
 * a robots.txt edit is served. Every change is reverted at the end.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial' });

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SCREENSHOT_DIR;
const run = Date.now().toString(36);
const PRODUCT = '/p/chalk-white';

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ({ ctx, page } = await ownerContext(browser));
});

test.afterAll(async () => {
  // Revert through the API (also when a test failed half-way).
  const csrf = (await ctx.cookies(ADMIN)).find((c) => c.name === 'fr_admin_csrf')?.value ?? '';
  const put = (path: string, data: object) =>
    page.request.put(`${ADMIN}/api/admin/seo/${path}`, { data, headers: { 'X-CSRF-Token': csrf } });
  await put('meta', { path: PRODUCT, locale: 'uz', title: '', description: '' });
  await put('robots', { custom: null });
  await put('verification', { google: null, yandex: null, bing: null });
  await ctx.close();
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

const storefrontTitle = async () => {
  const html = await (await page.request.get(`${WEB}/uz${PRODUCT}`)).text();
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
};

test('product SEO title edited in A9 shows on the storefront immediately', async () => {
  test.slow();
  const before = await storefrontTitle();
  expect(before).toMatch(/sotib olish \| Forest$/);

  await page.goto('/seo');
  await expect(page.getByTestId('seo-score')).toBeVisible();
  await page.getByTestId('seo-page-select').selectOption(PRODUCT);
  const title = `E2E SEO sarlavha ${run}`;
  await page.getByTestId('seo-title').fill(title);
  await expect(page.getByTestId('seo-serp')).toContainText(title);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-seo.png`, fullPage: true });
  await page.getByTestId('seo-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saqlandi' })).toBeVisible();

  // On-demand revalidation runs right after the save (fire-and-forget): seconds, not the 5 min ISR.
  await expect.poll(storefrontTitle, { timeout: 8_000, intervals: [250, 500, 1_000] }).toBe(title);

  await page.getByRole('button', { name: 'Shablonga qaytarish' }).click();
  await expect.poll(storefrontTitle, { timeout: 8_000 }).toBe(before);
});

test('verification code is rendered in the storefront <head>', async () => {
  const code = `e2e-${run}-verify`;
  await page.goto('/seo');
  await page
    .getByTestId('seo-verify-google')
    .fill(`<meta name="google-site-verification" content="${code}" />`);
  await page.getByTestId('seo-verify-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saqlandi' })).toBeVisible();
  await expect
    .poll(async () => (await page.request.get(`${WEB}/uz`)).text(), { timeout: 8_000 })
    .toContain(`<meta name="google-site-verification" content="${code}"/>`);
  const head = (await (await page.request.get(`${WEB}/ru/katalog`)).text()).split('</head>')[0]!;
  expect(head).toContain(`content="${code}"`);
});

test('robots.txt edited in A9 is served at /robots.txt', async () => {
  await page.goto('/seo');
  await page.getByRole('button', { name: 'Tahrirlash', expanded: false }).click();
  const editor = page.getByTestId('seo-robots');
  await expect(editor).toContainText('Disallow: /uz/checkout');
  await editor.fill(`User-agent: *\nDisallow: /e2e-${run}\n\nSitemap: ${WEB}/sitemap.xml\n`);
  await page.getByTestId('seo-robots-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'robots.txt saqlandi' })).toBeVisible();
  const robots = await (await page.request.get(`${WEB}/robots.txt`)).text();
  expect(robots).toContain(`Disallow: /e2e-${run}`);
  expect(robots).not.toContain('Disallow: /uz/checkout');

  const sitemap = await page.request.get(`${WEB}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('/sitemaps/uz-products.xml');
});
