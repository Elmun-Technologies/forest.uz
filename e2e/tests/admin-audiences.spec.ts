import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN, ownerContext } from './admin-helpers';

/**
 * A8 Auditoriyalar (desktop): the owner sees the preset segments, builds a new segment, the live
 * size equals the API preview of the same rules, saves it and finds it in the list. The created
 * segment is deleted afterwards (psql when available, else paused).
 */
test.use({ baseURL: ADMIN });

const run = `e2e${Date.now().toString(36)}`;

function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    return env.match(/^DATABASE_URL=([^#\n]*)/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

test('owner creates a segment and sees its live size', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'admin A8 is a desktop screen');
  test.slow();
  const { ctx, page } = await ownerContext(browser);
  await page.goto('/audiences');
  await expect(page.getByRole('heading', { name: 'Auditoriyalar va retarget' })).toBeVisible();
  await expect(page.getByTestId('audience-card').filter({ hasText: 'VIP mijozlar' })).toBeVisible();

  await page.getByTestId('audience-new').click();
  await expect(page).toHaveURL(/id=new/);
  const editor = page.getByTestId('audience-editor');
  await editor.getByTestId('audience-name').fill(`${run} lead`);
  // Replace the default rule with "Lead · raqam qoldirgan".
  const rule = editor.getByTestId('audience-rule').first();
  await rule.getByRole('combobox', { name: 'Qoida turi' }).selectOption('lead');

  const rules = { groups: [{ conditions: [{ type: 'lead', has: true, source: null }] }] };
  const encoded = Buffer.from(JSON.stringify(rules)).toString('base64url');
  const res = await page.request.get(`/api/admin/audiences/preview?rules=${encoded}`);
  expect(res.ok(), await res.text()).toBe(true);
  const expected = ((await res.json()) as { total: number }).total;
  await expect(editor.getByTestId('audience-size')).toHaveText(
    new Intl.NumberFormat('uz-UZ').format(expected).replace(/,/g, ' '),
    { timeout: 15_000 },
  );

  await editor.getByTestId('audience-save').click();
  await expect(page).toHaveURL(/id=(?!new)[\w-]+/, { timeout: 15_000 });
  const id = new URL(page.url()).searchParams.get('id')!;
  await expect(page.getByTestId('audience-card').filter({ hasText: `${run} lead` })).toBeVisible();
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.SCREENSHOT_DIR, 'admin-audiences.png'),
      fullPage: true,
    });

  const db = databaseUrl();
  let deleted = false;
  if (db) {
    try {
      execFileSync(
        'psql',
        [db, '-qX', '-c', `DELETE FROM "Segment" WHERE id = '${id.replace(/'/g, '')}'`],
        {
          stdio: 'pipe',
        },
      );
      deleted = true;
    } catch {
      // No psql: pause it instead (no delete endpoint, by design).
    }
  }
  if (!deleted) {
    const csrf = (await ctx.cookies()).find((c) => c.name === 'fr_admin_csrf')?.value ?? '';
    await page.request.patch(`/api/admin/audiences/${id}`, {
      data: { active: false },
      headers: { 'X-CSRF-Token': csrf },
    });
  }
  await ctx.close();
});
