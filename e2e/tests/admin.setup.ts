import { test as setup } from '@playwright/test';
import { ADMIN, adminLogin, OWNER_STATE, ownerCredentials, spreadAdminIp } from './admin-helpers';

/**
 * One owner login for the whole run, stored for the admin specs (`ownerContext`). The TOTP replay
 * rule accepts one code per 30 s step, so parallel suites each logging the owner in starve on
 * steps; this setup project runs before the desktop project.
 */
setup('owner session', async ({ browser }) => {
  setup.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL: ADMIN });
  await spreadAdminIp(ctx);
  const page = await ctx.newPage();
  const owner = ownerCredentials();
  await adminLogin(page, owner.email, owner.password);
  await ctx.storageState({ path: OWNER_STATE });
  await ctx.close();
});
