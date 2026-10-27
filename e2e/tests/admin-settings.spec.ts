import { randomBytes } from 'node:crypto';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  acceptInvite,
  ADMIN,
  adminLogin,
  enrolTotp,
  ownerCredentials,
  spreadAdminIp,
} from './admin-helpers';
import { uniquePhone } from './helpers';

/**
 * Admin A16 Settings / A4–A5 Customers / A10 Integrations (desktop): a delivery price edited in
 * the admin reaches the storefront quote; a customer's phone reveal lands in the audit log; a
 * Manager sees the integrations hub but cannot touch keys.
 */
test.use({ baseURL: ADMIN });
// Owner logins wait for an unused TOTP step (other suites log in as the owner too).
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);
const managerEmail = `e2e-int-manager-${run}@staff.test`;
const managerPassword = `kuzgi-${randomBytes(6).toString('hex')}`;
let managerInvite = '';

/** One owner session for the whole file: each login burns a TOTP step shared with other suites. */
let ownerCtx: BrowserContext | undefined;
let ownerPage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  ownerCtx = await browser.newContext({ baseURL: ADMIN, viewport: { width: 1440, height: 900 } });
  await spreadAdminIp(ownerCtx);
  ownerPage = await ownerCtx.newPage();
  const owner = ownerCredentials();
  await adminLogin(ownerPage, owner.email, owner.password);
});
test.afterAll(async () => {
  await ownerCtx?.close();
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

async function csrf(context: BrowserContext): Promise<string> {
  const c = (await context.cookies(ADMIN)).find((x) => x.name === 'fr_admin_csrf');
  expect(c, 'admin CSRF cookie').toBeTruthy();
  return c!.value;
}

async function quotePrice(page: Page, zoneKey: string): Promise<number> {
  const res = await page.request.get(`${WEB}/api/cart/quote?region=tashkent_city`);
  expect(res.ok()).toBe(true);
  const options = (await res.json()) as { zoneKey: string; priceSoum: number }[];
  return options.find((o) => o.zoneKey === zoneKey)!.priceSoum;
}

test('owner changes a delivery zone price → storefront quote shows it', async () => {
  const page = ownerPage;
  await page.goto('/settings/delivery');
  await expect(page.getByRole('heading', { name: 'Yetkazish zonalari' })).toBeVisible();

  const row = page.locator('tr[data-carrier="YANDEX"]').first();
  const testId = (await row.getAttribute('data-testid'))!;
  const zoneKey = testId.replace(/^zone-/, '');
  const price = row.getByLabel(/: narx$/);
  const original = Number(await price.inputValue());
  const changed = original === 37_300 ? 38_300 : 37_300;

  await price.fill(String(changed));
  await expect(page.getByTestId('delivery-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Saqlash' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saqlandi' })).toBeVisible();
  try {
    // The API prices carts from settings at once (no storefront rebuild).
    await expect.poll(() => quotePrice(page, zoneKey), { timeout: 20_000 }).toBe(changed);
  } finally {
    await page.reload();
    const again = page.getByTestId(testId).getByLabel(/: narx$/);
    await again.fill(String(original));
    await page.getByRole('button', { name: 'Saqlash' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saqlandi' })).toBeVisible();
  }
  await expect.poll(() => quotePrice(page, zoneKey)).toBe(original);

  // The change is in the audit log.
  await page.goto('/settings/audit?entity=Setting');
  await expect(page.getByTestId('audit-list')).toContainText("Yetkazish sozlamalarini o'zgartirdi");
});

test('owner reveals a customer phone → audit row on the audit page', async () => {
  const page = ownerPage;
  // A fresh lead (storefront popup) so the list has a known customer.
  const local = uniquePhone();
  const lead = await page.request.post(`${WEB}/api/leads`, {
    data: { phone: local, source: 'popup', marketingConsent: true },
    headers: {
      'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  });
  expect(lead.ok(), await lead.text()).toBe(true);

  await page.goto(`/customers?q=${local}`);
  const rows = page.getByTestId('customer-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('*** **');
  await rows.first().getByRole('link').click();
  // No name (lead): the masked phone is the title.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('*** **');

  await page.getByRole('button', { name: "Raqam va manzilni ko'rsatish" }).click();
  const pii = page.getByTestId('customer-pii');
  await expect(pii).toContainText(`+998 ${local.slice(0, 2)} ${local.slice(2, 5)}`);

  await page.goto('/settings/audit?entity=Customer');
  await expect(page.getByTestId('audit-list').locator('li').first()).toContainText(
    "Mijozning shaxsiy ma'lumotlarini ko'rdi",
  );
});

test('owner invites a Manager for the integrations check', async () => {
  const page = ownerPage;
  const context = ownerCtx!;
  const res = await page.request.post('/api/admin/staff', {
    data: { name: `E2E Int Menejer ${run}`, email: managerEmail, role: 'MANAGER' },
    headers: { 'X-CSRF-Token': await csrf(context) },
  });
  expect(res.status(), await res.text()).toBe(201);
  managerInvite = ((await res.json()) as { inviteUrl: string }).inviteUrl;

  // The owner sees credential forms in the hub.
  await page.goto('/integrations?key=payme');
  const detail = page.getByTestId('integration-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: /Ulash|Saqlash va tekshirish/ })).toBeVisible();
  await expect(page.getByTestId('integrations-connected')).toContainText(/\d+ \/ \d+ ulangan/);
});

test('manager sees the hub but cannot open integration keys', async ({ page, context }) => {
  expect(managerInvite).toBeTruthy();
  await acceptInvite(page, managerInvite, managerPassword);
  await enrolTotp(page, managerEmail);
  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await nav.getByRole('link', { name: 'Integratsiyalar' }).click();
  await expect(page).toHaveURL(/\/integrations$/);
  await page.getByTestId('integration-payme').getByRole('button').click();
  const detail = page.getByTestId('integration-detail');
  await expect(detail).toContainText("Kalitlarni faqat Egasi o'zgartira oladi.");
  await expect(
    detail.getByRole('button', { name: /^(Ulash|Saqlash va tekshirish|Uzish)$/ }),
  ).toHaveCount(0);
  await expect(detail.getByLabel('Maxfiy kalit')).not.toBeEditable();

  // The API refuses key changes and secret reveals for a Manager.
  const token = await csrf(context);
  const put = await page.request.put('/api/admin/integrations/payme', {
    data: { fields: { merchantId: 'x' } },
    headers: { 'X-CSRF-Token': token },
  });
  expect(put.status()).toBe(403);
  const reveal = await page.request.post('/api/admin/integrations/eskiz/webhook-url', {
    headers: { 'X-CSRF-Token': token },
  });
  expect(reveal.status()).toBe(403);

  // Store settings are Owner-only; delivery is open to the Manager.
  await page.goto('/settings/store');
  await expect(page.getByText("Bu bo'lim uchun huquq yo'q")).toBeVisible();
  await page.goto('/settings/delivery');
  await expect(page.getByRole('heading', { name: 'Yetkazish zonalari' })).toBeVisible();
});

test('owner deactivates the e2e manager', async () => {
  const page = ownerPage;
  const context = ownerCtx!;
  const staff = (await (await page.request.get('/api/admin/staff')).json()) as {
    id: string;
    email: string;
  }[];
  const m = staff.find((s) => s.email === managerEmail);
  expect(m).toBeTruthy();
  const res = await page.request.patch(`/api/admin/staff/${m!.id}`, {
    data: { active: false },
    headers: { 'X-CSRF-Token': await csrf(context) },
  });
  expect(res.ok()).toBe(true);
});
