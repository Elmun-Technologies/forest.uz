import { expect, test } from '@playwright/test';
import {
  acceptInvite,
  ADMIN,
  adminLogin,
  enrolTotp,
  ownerCredentials,
  spreadAdminIp,
} from './admin-helpers';

/**
 * Admin foundation (Phase 3): owner login with TOTP, panel shell, staff invites, role-filtered
 * navigation. Runs against the admin app (`ADMIN_URL`, :3001) with fake providers + dev
 * endpoints (TOTP codes from `/v1/dev/admin-totp`). Desktop only: the admin targets ≥ 1024 px.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

const run = Date.now().toString(36);
const PASSWORD = 'yashil-bog-2026-kuz';
const invited: { manager?: string; warehouse?: string } = {};

test('owner: login → TOTP → shell → staff → invite → logout', async ({ page }) => {
  const owner = ownerCredentials();
  await adminLogin(page, owner.email, owner.password);

  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  for (const group of ['Asosiy', 'Savdo', 'Katalog', 'Marketing'])
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  // Every sidebar page exists since Phase 4–5 (no "tez orada" items left): real links only.
  await expect(nav.getByRole('link', { name: 'Analitika' })).toHaveAttribute('href', '/analytics');
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);

  await nav.getByRole('link', { name: 'Sozlamalar' }).click();
  await expect(page).toHaveURL(/\/settings\/staff$/);
  await expect(page.getByRole('heading', { name: 'Xodimlar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rollar va huquqlar' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Integratsiya kalitlari/ })).toBeVisible();

  for (const [key, role, label] of [
    ['manager', 'MANAGER', 'Menejer'],
    ['warehouse', 'WAREHOUSE', 'Omborchi'],
  ] as const) {
    await page.getByRole('button', { name: '+ Taklif qilish' }).click();
    const form = page.getByRole('form', { name: 'Xodimni taklif qilish' });
    await form.getByLabel('Ism').fill(`E2E ${label} ${run}`);
    await form.getByLabel('Email').fill(`e2e-${key}-${run}@staff.test`);
    await form.getByLabel('Rol').selectOption(role);
    await form.getByRole('button', { name: 'Taklif havolasini yaratish' }).click();
    const url = page.getByTestId('invite-url');
    await expect(url).toContainText(`${ADMIN}/invite/`);
    invited[key] = (await url.innerText()).trim();
    await expect(page.getByRole('row', { name: new RegExp(`E2E ${label} ${run}`) })).toContainText(
      'Taklif yuborilgan',
    );
    await page.getByRole('button', { name: 'Yopish' }).click();
  }

  // Audit log shows the invites (no token in the UI or the log).
  await page.getByRole('link', { name: 'Faoliyat jurnali' }).first().click();
  await expect(page).toHaveURL(/\/settings\/audit/);
  await expect(page.getByTestId('audit-list')).toContainText('Xodimni taklif qildi');

  await page.getByRole('button', { name: 'Chiqish' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/settings/staff');
  await expect(page).toHaveURL(/\/login$/);
});

test('invited Manager: password → mandatory TOTP enrolment → panel', async ({ page }) => {
  expect(invited.manager).toBeTruthy();
  await acceptInvite(page, invited.manager!, PASSWORD);
  await enrolTotp(page, `e2e-manager-${run}@staff.test`);
  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await expect(nav).toBeVisible();
  await expect(nav.getByText(`E2E Menejer ${run}`)).toBeVisible();
  // Manager: delivery settings + audit yes, staff management no (first permitted tab opens).
  await nav.getByRole('link', { name: 'Sozlamalar' }).click();
  await expect(page).toHaveURL(/\/settings\/delivery$/);
  await page.goto('/settings/staff');
  await expect(page.getByText("Bu bo'lim uchun huquq yo'q")).toBeVisible();
});

test('Warehouse user does not see Marketing items', async ({ page }) => {
  expect(invited.warehouse).toBeTruthy();
  await acceptInvite(page, invited.warehouse!, PASSWORD);
  // TOTP is optional for Warehouse: straight into the panel.
  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await expect(nav).toBeVisible();
  for (const visible of ['Dashboard', 'Buyurtmalar', 'Mahsulotlar', 'MoySklad'])
    await expect(nav.getByText(visible)).toBeVisible();
  for (const hidden of [
    'Marketing',
    'Promo-kodlar',
    'SEO markazi',
    'Integratsiyalar',
    'Sozlamalar',
    'Analitika',
    'Mijozlar',
  ])
    await expect(nav.getByText(hidden)).toHaveCount(0);
  await page.goto('/settings/audit');
  await expect(page.getByText("Bu bo'lim uchun huquq yo'q")).toBeVisible();
});

test('owner deactivates the e2e staff (confirmed, sessions end)', async ({ page, browser }) => {
  const owner = ownerCredentials();
  await adminLogin(page, owner.email, owner.password);
  await page.goto('/settings/staff');
  page.on('dialog', (d) => void d.accept());
  for (const label of ['Menejer', 'Omborchi']) {
    const row = page.getByRole('row', { name: new RegExp(`E2E ${label} ${run}`) });
    await row.getByRole('button', { name: "O'chirish" }).click();
    await expect(row).toContainText('Faol emas');
  }
  // A deactivated account can't sign in any more.
  const ctx = await browser.newContext({ baseURL: ADMIN });
  await spreadAdminIp(ctx);
  const other = await ctx.newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(`e2e-warehouse-${run}@staff.test`);
  await other.getByLabel('Parol').fill(PASSWORD);
  await other.getByRole('button', { name: 'Kirish' }).click();
  await expect(other.getByText(/Email yoki parol noto'g'ri/)).toBeVisible();
  await ctx.close();
});
