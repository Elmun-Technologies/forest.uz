import { expect, test } from '@playwright/test';
import { ADMIN, adminLogin, ownerCredentials, spreadAdminIp } from './admin-helpers';

/**
 * Admin A13 MoySklad (desktop, fake providers): the owner opens /moysklad from the sidebar, sees
 * the status and KPIs, runs "sync now" and gets a sync-log row written by the API worker.
 */
test.use({ baseURL: ADMIN });
// Owner logins wait for an unused TOTP step (other suites log in as the owner too).
test.describe.configure({ mode: 'serial', timeout: 150_000 });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

test('owner: MoySklad page → status, KPIs, flows → sync now → log row', async ({ page }) => {
  const owner = ownerCredentials();
  await adminLogin(page, owner.email, owner.password);

  const nav = page.getByRole('navigation', { name: 'Admin menyusi' });
  await nav.getByRole('link', { name: 'MoySklad' }).click();
  await expect(page).toHaveURL(/\/moysklad$/);
  await expect(page.getByRole('heading', { name: 'MoySklad sinxronlash' })).toBeVisible();

  await expect(page.getByTestId('moysklad-connection')).toBeVisible();
  for (const kpi of ['last', 'linked', 'orders', 'errors'])
    await expect(page.getByTestId(`moysklad-kpi-${kpi}`)).toBeVisible();
  await expect(page.getByTestId('moysklad-kpi-linked')).toContainText(/\d+ \/ \d+/);
  await expect(page.getByRole('heading', { name: "Ma'lumot oqimi" })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Qoldiqlar/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maydonlar mosligi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Qoidalar' })).toBeVisible();

  const firstRow = page.getByTestId('moysklad-log-row').first().locator('time');
  const before = (await firstRow.count()) ? await firstRow.getAttribute('datetime') : null;
  await page.getByTestId('moysklad-sync-now').click();
  await expect(page.getByRole('status').first()).toContainText("navbatga qo'yildi");
  // The queued job writes a summary row ("Qo'lda sinxronlash…") in the API worker.
  await expect
    .poll(
      async () => {
        await page.reload();
        const row = page
          .getByTestId('moysklad-log-row')
          .filter({ hasText: /sinxronlash/i })
          .first();
        return (await row.count()) ? await row.locator('time').getAttribute('datetime') : null;
      },
      { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
    )
    .not.toBe(before ?? null);
  await expect(page.getByTestId('moysklad-log-row').first()).toBeVisible();
});
