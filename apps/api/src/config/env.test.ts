import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://x@localhost/forest',
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: 'x'.repeat(32),
};

describe('loadEnv production guards', () => {
  it('refuses fake providers in production unless explicitly allowed', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', PROVIDERS_MODE: 'fake' })).toThrow(
      /PROVIDERS_MODE=fake/,
    );
  });

  it('refuses DEV_ENDPOINTS in production without ALLOW_FAKE_PROVIDERS (OTP codes would leak)', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', PROVIDERS_MODE: 'live', DEV_ENDPOINTS: 'true' }),
    ).toThrow(/DEV_ENDPOINTS/);
    // CI / demo stack (compose e2e): fake providers + dev outbox, explicitly allowed.
    const ci = loadEnv({
      ...base,
      NODE_ENV: 'production',
      PROVIDERS_MODE: 'fake',
      DEV_ENDPOINTS: 'true',
      ALLOW_FAKE_PROVIDERS: 'true',
    });
    expect(ci.DEV_ENDPOINTS).toBe(true);
    expect(loadEnv({ ...base, NODE_ENV: 'development', DEV_ENDPOINTS: 'true' }).DEV_ENDPOINTS).toBe(
      true,
    );
  });
});
