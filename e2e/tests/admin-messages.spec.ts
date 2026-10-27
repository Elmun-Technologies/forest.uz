import { randomBytes } from 'node:crypto';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { acceptInvite, ADMIN, ownerContext, spreadAdminIp } from './admin-helpers';
import { API, uniquePhone } from './helpers';

/**
 * A12 messages (desktop): the template editor validates variables live and previews the bubble;
 * a custom audience template is created; "O'zimga test" sends the saved text by SMS to the staff
 * member's own phone (fake SMS provider → dev outbox). Leaves no template behind.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = Date.now().toString(36);
const key = `custom_e2e_${run}`;
const marketerEmail = `e2e-msg-marketer-${run}@staff.test`;
const marketerPassword = `bahor-${randomBytes(6).toString('hex')}`;
const marketerPhone = `+998${uniquePhone()}`;
let invite = '';

let ownerCtx: BrowserContext | undefined;
let ownerPage: Page;

async function csrf(context: BrowserContext): Promise<string> {
  const c = (await context.cookies(ADMIN)).find((x) => x.name === 'fr_admin_csrf');
  expect(c, 'admin CSRF cookie').toBeTruthy();
  return c!.value;
}

test.beforeAll(async ({ browser }, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  ({ ctx: ownerCtx, page: ownerPage } = await ownerContext(browser, {
    viewport: { width: 1440, height: 900 },
  }));
  await ownerPage.goto('/');
});

test.afterAll(async () => {
  if (ownerCtx) {
    await ownerPage.request.delete(`/api/admin/messaging/templates/${key}`, {
      headers: { 'X-CSRF-Token': await csrf(ownerCtx) },
    });
    await ownerCtx.close();
  }
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin panel e2e runs on desktop only');
  await spreadAdminIp(context);
});

test('editor validates variables live and previews the message', async () => {
  const page = ownerPage;
  await page.goto('/bot/messages?key=order_created');
  const editor = page.getByTestId('template-editor');
  await expect(editor.getByRole('heading', { name: 'Buyurtma qabul qilindi' })).toBeVisible();
  await expect(editor.getByTestId('template-preview')).toContainText(
    'Forest: buyurtma F-10001 qabul qilindi',
  );
  const body = editor.getByTestId('template-body-uz');
  const original = await body.inputValue();
  await body.fill(`${original} {kod}`);
  await expect(editor.getByTestId('template-problems')).toContainText(
    '{kod} bu shablonda ishlatilmaydi',
  );
  await expect(editor.getByTestId('template-save')).toBeDisabled();
  // Order texts are service messages: no opt-out button in the preview.
  await expect(editor).not.toContainText("Eslatmani o'chirish");
  await body.fill(original);
  await expect(editor.getByTestId('template-problems')).toHaveCount(0);
});

test('owner creates a custom audience template (marketing: opt-out shown)', async () => {
  const page = ownerPage;
  await page.goto('/bot/messages?key=new');
  const editor = page.getByTestId('template-editor');
  await editor.getByTestId('template-key').fill(key);
  await editor.getByTestId('template-body-uz').fill('{ism}, yangi to‘plamlar keldi: {link}');
  await editor.getByRole('button', { name: 'RU', exact: true }).click();
  await editor.getByTestId('template-body-ru').fill('{ism}, новые наборы: {link}');
  await expect(editor.getByTestId('template-preview')).toContainText(
    'Имя, новые наборы: https://forest.uz',
  );
  await expect(editor).toContainText('Отключить напоминания');
  await editor.getByTestId('template-approved').check();
  await editor.getByTestId('template-save').click();
  await expect(page).toHaveURL(new RegExp(`key=${key}$`));
  await page.reload();
  await expect(page.getByTestId('template-editor')).toContainText(key);
  await expect(page.getByTestId('template-body-uz')).toHaveValue(
    '{ism}, yangi to‘plamlar keldi: {link}',
  );
  await expect(page.getByTestId('template-row').filter({ hasText: key })).toContainText('Eskiz ✓');

  // The owner has no phone on file: the test send explains why instead of failing silently.
  await page.getByTestId('template-test').click();
  await expect(page.getByTestId('template-editor')).toContainText('telefon raqami yo');

  const res = await page.request.post('/api/admin/staff', {
    data: {
      name: `E2E Xabar Marketolog ${run}`,
      email: marketerEmail,
      role: 'MARKETER',
      phone: marketerPhone,
    },
    headers: { 'X-CSRF-Token': await csrf(ownerCtx!) },
  });
  expect(res.status(), await res.text()).toBe(201);
  invite = ((await res.json()) as { inviteUrl: string }).inviteUrl;
});

test('marketer sends the saved template to their own phone', async ({ page, request }) => {
  expect(invite).toBeTruthy();
  await acceptInvite(page, invite, marketerPassword);
  await expect(page.getByRole('navigation', { name: 'Admin menyusi' })).toBeVisible({
    timeout: 20_000,
  });
  await page.goto(`/bot/messages?key=${key}`);
  const editor = page.getByTestId('template-editor');
  await editor.getByTestId('template-test').click();
  await expect(editor.getByRole('status')).toContainText('Test yuborildi');

  await expect
    .poll(async () => {
      const out = await request.get(`${API}/v1/dev/outbox?to=${encodeURIComponent(marketerPhone)}`);
      const list = (await out.json()) as { text: string }[];
      return list[0]?.text ?? '';
    })
    .toMatch(/^\[TEST\]\nE2E, yangi to‘plamlar keldi: https:\/\/forest\.uz$/);
});
