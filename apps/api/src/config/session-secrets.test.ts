import { describe, expect, it } from 'vitest';
import { signUnsubscribe, verifyUnsubscribe } from '../messaging/unsubscribe';
import { PRIVATE_PATH } from '../bootstrap';
import { sessionSecrets, verifyWithAny } from './session-secrets';
import { envSchema } from './env';

const OLD = 'o'.repeat(40);
const NEW = 'n'.repeat(40);

describe('SESSION_SECRET rotation (ASVS F-07)', () => {
  it('parses a comma list of earlier secrets and keeps the current one first', () => {
    const env = { SESSION_SECRET: NEW, SESSION_SECRET_PREVIOUS: [OLD, NEW] };
    expect(sessionSecrets(env)).toEqual([NEW, OLD]);
    expect(envSchema.shape.SESSION_SECRET_PREVIOUS.parse(` ${OLD} ,`)).toEqual([OLD]);
    expect(envSchema.shape.SESSION_SECRET_PREVIOUS.parse(undefined)).toEqual([]);
    expect(() => envSchema.shape.SESSION_SECRET_PREVIOUS.parse('short')).toThrow();
  });

  it('verifies a token signed before the rotation, and not without the previous secret', () => {
    const token = signUnsubscribe('SMS', 'C-10001', OLD);
    const verify = (secret: string) => verifyUnsubscribe(token, secret);
    expect(verifyWithAny({ SESSION_SECRET: NEW, SESSION_SECRET_PREVIOUS: [OLD] }, verify)).toEqual({
      channel: 'SMS',
      publicId: 'C-10001',
    });
    expect(verifyWithAny({ SESSION_SECRET: NEW, SESSION_SECRET_PREVIOUS: [] }, verify)).toBeNull();
  });
});

describe('private API paths get Cache-Control no-store (ASVS F-09)', () => {
  it('matches personal routes only', () => {
    for (const p of [
      '/v1/me',
      '/v1/me/orders',
      '/v1/admin/orders',
      '/v1/cart',
      '/v1/webhooks/click/prepare',
      '/v1/t',
    ])
      expect(PRIVATE_PATH.test(p)).toBe(true);
    for (const p of [
      '/v1/catalog/products',
      '/v1/seo/meta',
      '/v1/settings/public',
      '/v1/tracking',
      '/v1/mebel',
    ])
      expect(PRIVATE_PATH.test(p)).toBe(false);
  });
});
