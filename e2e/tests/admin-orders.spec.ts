import { randomBytes } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { acceptInvite, ADMIN, ownerContext, spreadAdminIp } from './admin-helpers';
import { API, uniquePhone } from './helpers';

/**
 * Admin orders A6/A7 (Phase 3): a storefront COD order (BTS zone) is found in /orders and walked
 * by the owner through confirm → packing → ready → fiscal receipt → BTS waybill → delivered →
 * complete; a Warehouse user sees the order but no refund/cancel. Desktop only (admin ≥ 1024 px);
 * screenshots go to `SCREENSHOT_DIR` when set.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const SHOTS = process.env.SCREENSHOT_DIR;
const run = Date.now().toString(36);
const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

/** Storefront order straight through the public API (cart cookie kept by the request context). */
async function placeOrder(
  request: APIRequestContext,
  method: 'COD' | 'CLICK',
): Promise<{ number: string; publicId: string }> {
  const list = (await (await request.get(`${API}/v1/catalog/products?limit=60`)).json()) as {
    items: { slug: string; inStock: boolean }[];
  };
  let variantId: string | null = null;
  let best = 0;
  for (const p of list.items.filter((x) => x.inStock)) {
    const detail = (await (await request.get(`${API}/v1/catalog/products/${p.slug}`)).json()) as {
      variants: { id: string; available: number }[];
    };
    for (const v of detail.variants)
      if (v.available > best) ({ id: variantId, available: best } = v);
  }
  expect(variantId, 'an in-stock variant').toBeTruthy();
  const ip = randomIp();
  const cart = await request.post(`${API}/v1/cart/items`, {
    data: { variantId, qty: 1 },
    headers: { 'x-forwarded-for': ip },
  });
  expect(cart.ok(), await cart.text()).toBe(true);
  const res = await request.post(`${API}/v1/checkout/orders`, {
    headers: {
      'Idempotency-Key': `e2e-ao-${run}-${randomBytes(6).toString('hex')}`,
      'x-forwarded-for': ip,
    },
    data: {
      name: `E2E Mijoz ${run}`,
      phone: `+998${uniquePhone()}`,
      region: 'samarkand',
      addressLine: "Registon ko'chasi, 5-uy",
      zoneKey: 'regions-bts',
      paymentMethod: method,
      offerVersion: 'v1',
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { orderNumber: string; publicId: string };
  if (method !== 'COD') {
    const paid = await request.post(`${API}/v1/dev/fake-pay`, {
      data: { order: body.publicId, result: 'success' },
    });
    expect(paid.ok(), await paid.text()).toBe(true);
  }
  return { number: body.orderNumber, publicId: body.publicId };
}

async function act(page: Page, key: string, expectStatus: string | RegExp) {
  await page.getByTestId(`action-${key}`).click();
  await expect(page.getByTestId('order-status')).toHaveText(expectStatus, { timeout: 15_000 });
}

async function dialogSave(
  page: Page,
  title: string,
  fill: () => Promise<void>,
  button = 'Saqlash',
) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await fill();
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

const orders: { cod?: string; click?: string; warehouseInvite?: string } = {};

test('owner: storefront COD order → confirm → pack → receipt → BTS → delivered → complete', async ({
  browser,
  playwright,
}) => {
  const shop = await playwright.request.newContext();
  const cod = await placeOrder(shop, 'COD');
  orders.cod = cod.number;
  orders.click = (await placeOrder(shop, 'CLICK')).number;
  await shop.dispose();

  const { page } = await ownerContext(browser);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await expect(nav.getByTestId('orders-badge')).toBeVisible({ timeout: 15_000 });
  await nav.getByRole('link', { name: /Buyurtmalar/ }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'Buyurtmalar' })).toBeVisible();

  await page.getByPlaceholder('№, mijoz, telefon, trek raqami').fill(cod.number);
  await page.getByRole('button', { name: "Ko'rsatish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${cod.number}`));
  const row = page.getByTestId('order-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Yangi');
  await expect(row).toContainText('*** **');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/orders-list-1440.png`, fullPage: true });
  await row.getByRole('link', { name: cod.number }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${cod.number}$`));

  await act(page, 'confirm_cod', 'Tasdiqlandi');
  await expect(page.getByTestId('sla-box')).toBeVisible();
  await act(page, 'start_packing', "Yig'ilmoqda");
  await act(page, 'mark_ready', "Yig'ildi");

  await page.getByRole('button', { name: 'Fiskal chekni kiritish' }).click();
  await dialogSave(page, 'Fiskal chek', () => page.getByLabel('Chek raqami').fill(`FK-${run}`));
  await expect(page.getByTestId('fiscal-receipt')).toContainText(`FK-${run}`);

  await page.getByTestId('action-bts_update').click();
  await dialogSave(page, 'BTS: yuk holati', async () => {
    await page.getByLabel('Holat', { exact: true }).selectOption('PICKED_UP');
    await page.getByLabel('Yuk xati (trek) raqami').fill(`BTS-${run}`);
  });
  await expect(page.getByTestId('order-status')).toHaveText("Yo'lda");
  await page.getByTestId('action-bts_update').click();
  await dialogSave(page, 'BTS: yuk holati', async () => {
    await page.getByLabel('Holat', { exact: true }).selectOption('DELIVERED');
  });
  await expect(page.getByTestId('order-status')).toHaveText('Yetkazildi');

  await page.getByTestId('action-cod_settled').click();
  await expect(page.getByTestId('payment-panel')).toContainText("To'langan");
  await act(page, 'complete', 'Yakunlandi');
  const timeline = page.getByTestId('order-timeline');
  await expect(timeline).toContainText('Fiskal chek kiritildi');
  await expect(timeline).toContainText(`BTS-${run}`);

  // Internal note + audited PII reveal.
  await page.getByRole('textbox', { name: 'Ichki izoh' }).fill('E2E: mijoz mamnun');
  await page.getByRole('button', { name: 'Saqlash' }).click();
  await expect(timeline).toContainText('E2E: mijoz mamnun');
  await page.getByTestId('reveal-pii').click();
  await expect(page.getByTestId('delivery-address')).toContainText('Registon');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/order-detail-1440.png`, fullPage: true });
  // Critical actions stay usable on a phone (docs/08).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('order-detail')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/order-detail-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Paid Click order: the owner may refund (manual record).
  await page.goto(`/orders/${orders.click}`);
  await expect(page.getByTestId('payment-panel').getByTestId('action-refund')).toBeVisible();

  // Invite a Warehouse user for the next test (one owner login per run: TOTP steps are shared).
  const csrf =
    (await page.context().cookies()).find((c) => c.name === 'fr_admin_csrf')?.value ?? '';
  const invite = await page.request.post(`${ADMIN}/api/admin/staff`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { name: `E2E Ombor ${run}`, email: `e2e-orders-wh-${run}@staff.test`, role: 'WAREHOUSE' },
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  orders.warehouseInvite = ((await invite.json()) as { inviteUrl: string }).inviteUrl;
});

test('Warehouse: works the order, never sees refund or cancel', async ({ page }) => {
  expect(orders.click).toBeTruthy();
  expect(orders.warehouseInvite).toBeTruthy();
  const inviteUrl = orders.warehouseInvite!;

  await acceptInvite(page, inviteUrl, `Qz-${randomBytes(12).toString('base64url')}`);
  await expect(page.getByRole('navigation', { name: 'Admin menyusi' })).toBeVisible();
  await page.goto(`/orders/${orders.click}`);
  await expect(page.getByTestId('order-detail')).toBeVisible();
  await expect(page.getByTestId('action-start_packing')).toBeVisible();
  await expect(page.getByTestId('action-refund')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bekor qilish' })).toHaveCount(0);
  // Warehouse reveal = address only (packing slip), the phone stays masked.
  await page.getByTestId('reveal-pii').click();
  await expect(page.getByTestId('delivery-address')).toContainText('Registon');
  await expect(page.getByTestId('delivery-phone')).toContainText('***');
});
