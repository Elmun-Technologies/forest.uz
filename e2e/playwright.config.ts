import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against an already running stack (`pnpm dev` locally, compose in CI).
 * Desktop 1440 and mobile 390 projects mirror the design breakpoints.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally the stack runs as dev servers (on-demand route compiles): more workers only time out.
  workers: process.env.CI ? undefined : 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Owner admin session shared by the admin specs (one TOTP step instead of one per suite).
    {
      name: 'admin-setup',
      testMatch: /admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop',
      dependencies: ['admin-setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      dependencies: ['admin-setup'],
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
