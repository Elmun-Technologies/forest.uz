import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
} from '@playwright/test';
import { API } from './helpers';

/** Admin app origin (Next dev server or production build). */
export const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';

/** Owner session written by `admin.setup.ts` (gitignored). */
export const OWNER_STATE = path.resolve(__dirname, '../.auth/owner.json');

/** Bootstrap owner from the environment, else from the repo's local `.env` (dev stack). */
export function ownerCredentials(): { email: string; password: string } {
  let email = process.env.OWNER_EMAIL;
  let password = process.env.OWNER_INITIAL_PASSWORD;
  if (!email || !password) {
    try {
      const env = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
      const get = (k: string) => env.match(new RegExp(`^${k}=([^#\\n]*)`, 'm'))?.[1]?.trim();
      email ??= get('OWNER_EMAIL');
      password ??= get('OWNER_INITIAL_PASSWORD');
    } catch {
      // No .env (CI): the env vars above are required.
    }
  }
  if (!email || !password) throw new Error('OWNER_EMAIL / OWNER_INITIAL_PASSWORD not set');
  return { email, password };
}

const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/**
 * Admin auth endpoints are limited per client IP (20 / 15 min) and every test browser shares one:
 * give each auth request its own forwarded address (no proxy in front of the e2e stack).
 */
export async function spreadAdminIp(target: Page | BrowserContext) {
  await target.route('**/api/admin/auth/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': randomIp() } }),
  );
}

/**
 * Current TOTP code for a staff member from the dev-only endpoint (fake mode + DEV_ENDPOINTS). It
 * returns the next step the replay rule accepts; when none is acceptable yet (two logins within
 * 30 s), wait for the next step.
 */
export async function devTotp(request: APIRequestContext, email: string): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const res = await request.post(`${API}/v1/dev/admin-totp`, { data: { email } });
        if (res.status() === 429) return '';
        expect(res.ok(), await res.text()).toBe(true);
        code = ((await res.json()) as { code: string }).code;
        return code;
      },
      { timeout: 70_000, intervals: [2_000, 5_000] },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

/** Enrolment screen: get the QR, check it renders, confirm with the current code. */
export async function enrolTotp(page: Page, email: string) {
  await expect(page).toHaveURL(/\/totp\/setup$/);
  // Dev servers may still be hydrating after the client-side redirect: retry until the QR shows
  // (a repeated setup call just issues a fresh secret, which devTotp reads from the DB).
  await expect(async () => {
    await page.getByRole('button', { name: 'QR kodni olish' }).click();
    await expect(page.getByTestId('totp-qr')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('totp-secret')).toHaveText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
  await page.getByLabel('Ilovadagi 6 xonali kod').fill(await devTotp(page.request, email));
  await page.getByRole('button', { name: '2FA ni yoqish' }).click();
}

/** Password step, then TOTP (code or first-time enrolment) until the panel shell shows. */
export async function adminLogin(page: Page, email: string, password: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Parol').fill(password);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForURL(/\/(login\/totp|totp\/setup)?$/, { timeout: 20_000 });
  if (page.url().endsWith('/totp/setup')) await enrolTotp(page, email);
  else if (page.url().endsWith('/login/totp')) {
    await page.getByLabel('Ilovadagi 6 xonali kod').fill(await devTotp(page.request, email));
    await page.getByRole('button', { name: 'Kirish' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Admin menyusi' })).toBeVisible({
    timeout: 20_000,
  });
}

/** Browser context already signed in as the owner (session from `admin.setup.ts`). */
export async function ownerContext(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: ADMIN, ...options, storageState: OWNER_STATE });
  await spreadAdminIp(ctx);
  return { ctx, page: await ctx.newPage() };
}

/** Opens an invite link and sets the password. */
export async function acceptInvite(page: Page, inviteUrl: string, password: string) {
  await page.goto(inviteUrl);
  await expect(page.getByRole('heading', { name: /Xush kelibsiz/ })).toBeVisible();
  await page.getByLabel('Yangi parol').fill(password);
  await page.getByLabel('Parolni takrorlang').fill(password);
  await page.getByRole('button', { name: 'Parolni saqlash' }).click();
}
