import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { devTokenOk } from './dev-endpoints';

const base = {
  DATABASE_URL: 'postgresql://x@localhost/forest',
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: 'x'.repeat(32),
  PROVIDERS_MODE: 'fake',
  DEV_ENDPOINTS: 'true',
  ALLOW_FAKE_PROVIDERS: 'true',
};
const TOKEN = 't'.repeat(40);

describe('devTokenOk', () => {
  it('requires the token in production and fails closed when none is configured', () => {
    const prod = loadEnv({ ...base, NODE_ENV: 'production', DEV_ENDPOINTS_TOKEN: TOKEN });
    expect(devTokenOk(prod, TOKEN)).toBe(true);
    expect(devTokenOk(prod, 'x'.repeat(40))).toBe(false);
    expect(devTokenOk(prod, undefined)).toBe(false);
    expect(devTokenOk(prod, [TOKEN, TOKEN])).toBe(false);
    const demo = loadEnv({ ...base, NODE_ENV: 'production' });
    expect(devTokenOk(demo, undefined)).toBe(false);
    expect(devTokenOk(demo, TOKEN)).toBe(false);
  });

  it('outside production enforces a configured token, else stays open', () => {
    const dev = loadEnv({ ...base, NODE_ENV: 'development', DEV_ENDPOINTS_TOKEN: TOKEN });
    expect(devTokenOk(dev, undefined)).toBe(false);
    expect(devTokenOk(dev, TOKEN)).toBe(true);
    expect(devTokenOk(loadEnv({ ...base, NODE_ENV: 'development' }), undefined)).toBe(true);
  });
});

describe('optional secrets', () => {
  it('treat an empty value as unset', () => {
    const env = loadEnv({ ...base, DEV_ENDPOINTS_TOKEN: '', EDGE_PROXY_SECRET: '' });
    expect(env.DEV_ENDPOINTS_TOKEN).toBeUndefined();
    expect(env.EDGE_PROXY_SECRET).toBeUndefined();
    expect(() => loadEnv({ ...base, DEV_ENDPOINTS_TOKEN: 'short' })).toThrow(/DEV_ENDPOINTS_TOKEN/);
  });
});
