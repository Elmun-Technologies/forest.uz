import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ADMIN, ownerContext, spreadAdminIp } from './admin-helpers';

/**
 * Ilhom CMS (Phase 5, desktop): the owner writes and publishes an article in Uzbek only → it is
 * listed on `/uz/ilhom` and readable at `/uz/ilhom/<slug>`, while `/ru/…` stays 404 (each language
 * is published on its own). The article is deleted at the end.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial' });

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);
const SLUG = `e2e-ilhom-${run}`;
const TITLE = `Komodni bir kunda yangilash ${run}`;

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ({ ctx, page } = await ownerContext(browser));
});

test.afterAll(async () => {
  const csrf = (await ctx.cookies(ADMIN)).find((c) => c.name === 'fr_admin_csrf')?.value ?? '';
  await page.request.post(`${ADMIN}/api/admin/content/articles/${SLUG}/delete`, {
    data: { confirm: SLUG },
    headers: { 'X-CSRF-Token': csrf },
  });
  await ctx.close();
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

test('an article published in admin appears on the storefront', async () => {
  test.slow();
  await page.goto('/content');
  await expect(page.getByRole('heading', { name: 'Ilhom va Brend' })).toBeVisible();
  await page.getByTestId('article-new').click();
  await expect(page).toHaveURL(/\/content\/articles\/new$/);

  await page.getByTestId('article-title').fill(TITLE);
  await page.getByLabel(/Qisqa mazmun/).fill('Eski MDF komod Chalk White bilan.');
  await page.getByTestId('article-slug').fill(SLUG);
  await page.getByRole('button', { name: '+ Matn' }).click();
  await page
    .getByTestId('block-text')
    .fill("Avval yuzani changdan tozalang, keyin ikki qatlam bo'yang.");
  await page.getByTestId('publish-toggle').click();
  await page.getByTestId('article-save').click();
  await expect(page).toHaveURL(new RegExp(`/content/articles/${SLUG}$`), { timeout: 30_000 });

  const article = await page.request.get(`${WEB}/uz/ilhom/${SLUG}`);
  expect(article.status()).toBe(200);
  const html = await article.text();
  expect(html).toContain('ikki qatlam bo&#x27;yang');
  expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(`${TITLE} | Forest`);
  expect((await page.request.get(`${WEB}/ru/ilhom/${SLUG}`)).status()).toBe(404);

  // The index is cached: the API's on-demand revalidation (`articles` tag) refreshes it.
  await expect
    .poll(async () => (await page.request.get(`${WEB}/uz/ilhom`)).text(), { timeout: 60_000 })
    .toContain(TITLE);
});
