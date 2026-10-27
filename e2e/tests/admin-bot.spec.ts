import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ADMIN, ownerContext } from './admin-helpers';
import { API } from './helpers';

/**
 * A12 bot (desktop): the overview shows KPIs and the five scenarios; a customer's Telegram
 * question (simulated through the fake transport) appears in the operator inbox, the owner
 * answers and closes it, and the answer reaches the chat.
 */
test.use({ baseURL: ADMIN });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const chatId = 600_000_000 + Math.floor(Math.random() * 99_000_000);
let ctx: BrowserContext | undefined;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  ({ ctx, page } = await ownerContext(browser, { viewport: { width: 1440, height: 900 } }));
});

test.afterAll(async () => {
  await ctx?.close();
});

test('overview: KPIs and scenario switches', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin is desktop-first');
  await page.goto('/bot');
  await expect(page.getByRole('heading', { name: 'Telegram bot va xabarlar' })).toBeVisible();
  await expect(page.getByTestId('bot-kpis')).toContainText('Obunachilar');
  for (const key of ['lead', 'orderStatus', 'abandonedCart', 'advice', 'review'])
    await expect(page.getByTestId(`scenario-${key}`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Operator inbox' })).toBeVisible();
});

test('inbox: a Telegram question is answered and closed', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin is desktop-first');
  const question = `Qaysi rang mos? e2e-${chatId}`;
  for (const text of ['/start', question]) {
    const r = await page.request.post(`${API}/v1/dev/bot/update`, {
      data: { chatId, text, firstName: 'Dilnoza' },
    });
    expect(r.ok()).toBe(true);
  }
  await page.goto('/bot/inbox?status=NEW');
  const row = page.getByTestId('inbox-row').filter({ hasText: question });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByTestId('inbox-reply').fill('Zaytun rangi juda mos keladi.');
  await page.getByTestId('inbox-send').click();
  await expect(page.getByText('Zaytun rangi juda mos keladi.')).toBeVisible();
  await expect(page.locator('section').getByText('Javob berildi').first()).toBeVisible();

  const sent = (await (
    await page.request.get(`${API}/v1/dev/bot/sent?chatId=${chatId}`)
  ).json()) as { text: string }[];
  expect(sent.some((m) => m.text.includes('Zaytun rangi juda mos keladi.'))).toBe(true);

  await page.getByTestId('inbox-close').click();
  await expect(page.getByTestId('inbox-close')).toHaveText('Qayta ochish');
});
