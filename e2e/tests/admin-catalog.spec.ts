import { randomBytes } from 'node:crypto';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { acceptInvite, ADMIN, adminLogin, ownerCredentials, spreadAdminIp } from './admin-helpers';
import { API, quietOverlays } from './helpers';

/**
 * Admin catalog (A11 products, A14 promo, A15 reviews), desktop only: the owner creates a product,
 * edits its name and price and the storefront shows them; creates a promo code that works in the
 * storefront cart; a Marketer edits products but has no orders. Screenshots → `SCREENSHOT_DIR`.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial' });

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SCREENSHOT_DIR;
const run = Date.now().toString(36);
const slug = `e2e-cat-${run}`;
const code = `E2E${run.toUpperCase()}`;
// A syntactically valid 17-digit IKPU (activation needs one; the seed placeholder is refused).
const IKPU = `0320900${String(Date.now()).slice(-10)}`;

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

/**
 * One owner login for the whole file (stored session): every login burns a TOTP step, and other
 * suites log the same owner in concurrently.
 */
let ownerState: string;
test.beforeAll(async ({ browser }, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  const ctx = await browser.newContext({ baseURL: ADMIN });
  await spreadAdminIp(ctx);
  const page = await ctx.newPage();
  const owner = ownerCredentials();
  await adminLogin(page, owner.email, owner.password);
  ownerState = testInfo.outputPath('owner-state.json');
  await ctx.storageState({ path: ownerState });
  await ctx.close();
});

async function ownerPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: ADMIN, storageState: ownerState });
  return { ctx, page: await ctx.newPage() };
}

test('owner creates a product, edits name and price → storefront shows them', async ({
  browser,
}) => {
  test.slow();
  const { ctx, page } = await ownerPage(browser);
  await page.goto('/products');
  await expect(page.getByTestId('product-row').first()).toBeVisible();
  await expect(page.getByTestId('product-editor')).toBeVisible();
  await shot(page, 'products');

  await page.getByTestId('product-create').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nomi · UZ').fill(`E2E bo'yoq ${run}`);
  await dialog.getByLabel('Nomi · RU').fill(`E2E краска ${run}`);
  await dialog.getByLabel('Manzil (slug)').fill(slug);
  await dialog.getByLabel('Kategoriya').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Yaratish' }).click();
  await expect(page).toHaveURL(/\/products\?id=/);
  const editor = page.getByTestId('product-editor');
  await expect(editor.getByRole('heading', { name: `E2E bo'yoq ${run}` })).toBeVisible();

  // Activating without a variant/IKPU is refused by the API (IKPU-before-ACTIVE).
  await editor.getByTestId('product-status').selectOption('ACTIVE');
  await editor.getByTestId('product-save').click();
  await expect(editor.getByRole('alert')).toBeVisible();

  await editor.getByRole('tab', { name: /Variantlar/ }).click();
  await editor.getByTestId('variant-add').click();
  const form = editor.getByTestId('variant-form');
  await form.getByLabel('Variant nomi · UZ').fill('1 L');
  await form.getByLabel('Variant nomi · RU').fill('1 л');
  await form.getByLabel('SKU', { exact: true }).fill(`E2E-${run}-1L`);
  await form.getByLabel('IKPU (MXIK)').fill(IKPU);
  await form.getByLabel("Narx, so'm", { exact: true }).fill('140000');
  await form.getByLabel('Qoldiq', { exact: true }).fill('50');
  await form.getByTestId('variant-save').click();
  await expect(editor.getByTestId('variant-row')).toHaveCount(1);

  await editor.getByRole('tab', { name: 'Asosiy' }).click();
  await editor.getByTestId('product-status').selectOption('ACTIVE');
  await editor.getByTestId('product-name-uz').fill(`E2E tahrir ${run}`);
  await editor.getByTestId('product-save').click();
  await expect(editor.getByRole('status')).toHaveText('Saqlandi');
  await expect(editor.getByRole('heading', { name: `E2E tahrir ${run}` })).toBeVisible();

  await editor.getByRole('tab', { name: /Variantlar/ }).click();
  await editor.getByTestId('variant-edit').click();
  await form.getByLabel("Narx, so'm", { exact: true }).fill('155000');
  await form.getByTestId('variant-save').click();
  await expect(editor.getByTestId('variant-row')).toContainText('155');
  await shot(page, 'products-variants');

  await expect(editor.getByTestId('view-on-site')).toHaveAttribute('href', `${WEB}/uz/p/${slug}`);
  await page.goto(`${WEB}/uz/p/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`E2E tahrir ${run}`);
  await expect(page.getByText(/155\s000/).first()).toBeVisible();
  await ctx.close();
});

test('owner creates a promo code; it applies in the storefront cart', async ({ browser }) => {
  test.slow();
  const { ctx, page } = await ownerPage(browser);
  await page.goto('/promo?id=new');
  const editor = page.getByTestId('promo-editor');
  await editor.getByTestId('promo-code').fill(code);
  await editor.getByTestId('promo-value').fill('20');
  await editor.getByTestId('promo-save').click();
  // Margin guard (≤ 15 %) is enforced by the API.
  await expect(editor.getByRole('alert')).toContainText('15%');
  await editor.getByTestId('promo-value').fill('10');
  await editor.getByTestId('promo-save').click();
  await expect(page).toHaveURL(/\/promo\?id=/);
  await expect(page.getByTestId('promo-row').filter({ hasText: code })).toBeVisible();
  await shot(page, 'promo');

  const shop: BrowserContext = await browser.newContext({ baseURL: WEB });
  await quietOverlays(shop, WEB);
  const shopper = await shop.newPage();
  const detail = (await (
    await shopper.request.get(`${API}/v1/catalog/products/${slug}`)
  ).json()) as {
    variants: { id: string }[];
  };
  const add = await shopper.request.post('/api/cart/items', {
    data: { variantId: detail.variants[0]!.id, qty: 1 },
  });
  expect(add.ok(), await add.text()).toBe(true);
  await shopper.goto('/uz/savat');
  await expect(shopper.getByTestId('cart-line').first()).toBeVisible();
  await shopper.getByTestId('promo-input').fill(code.toLowerCase());
  await shopper.getByRole('button', { name: "Qo'llash" }).click();
  await expect(shopper.getByTestId('promo-applied')).toContainText(code);
  await shop.close();

  // Pause it again so the dev catalog doesn't keep a live test code.
  page.once('dialog', (d) => void d.accept());
  await editor.getByTestId('promo-toggle').click();
  await expect(editor.getByText("To'xtatilgan").first()).toBeVisible();
  await ctx.close();
});

test('marketer edits products and reviews, but has no orders', async ({ page, browser }) => {
  test.slow();
  const { ctx: ownerCtx, page: op } = await ownerPage(browser);
  const csrf = (await ownerCtx.cookies()).find((c) => c.name === 'fr_admin_csrf')?.value ?? '';
  const invite = await op.request.post(`${ADMIN}/api/admin/staff`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      name: `E2E Marketolog ${run}`,
      email: `e2e-cat-mk-${run}@staff.test`,
      role: 'MARKETER',
    },
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  const { inviteUrl } = (await invite.json()) as { inviteUrl: string };
  await op.goto('/reviews');
  await expect(op.getByRole('heading', { name: 'Sharhlar va natija fotolari' })).toBeVisible();
  await shot(op, 'reviews');
  await ownerCtx.close();

  await acceptInvite(page, inviteUrl, `Qz-${randomBytes(12).toString('base64url')}`);
  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Mahsulotlar' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Promo-kodlar' })).toBeVisible();
  await expect(nav.getByText('Buyurtmalar')).toHaveCount(0);
  const orders = await page.request.get(`${ADMIN}/api/admin/orders`);
  expect(orders.status()).toBe(403);

  await nav.getByRole('link', { name: 'Mahsulotlar' }).click();
  await page.getByTestId('product-search').fill(slug);
  await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByTestId('product-row').first().click();
  const editor = page.getByTestId('product-editor');
  await expect(editor.getByRole('heading', { name: `E2E tahrir ${run}` })).toBeVisible();
  await editor.getByTestId('product-name-uz').fill(`E2E marketolog ${run}`);
  await editor.getByTestId('product-save').click();
  await expect(editor.getByRole('status')).toHaveText('Saqlandi');

  // Leave the dev catalog as it was: archive the test product.
  await editor.getByTestId('product-status').selectOption('ARCHIVED');
  await editor.getByTestId('product-save').click();
  await expect(editor.getByRole('status')).toHaveText('Saqlandi');
});
