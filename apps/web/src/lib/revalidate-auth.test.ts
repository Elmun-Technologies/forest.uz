import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const appKey = Buffer.alloc(32, 7).toString('base64');

/** Independent re-implementation of the API side (apps/api/src/seo/revalidate-signature.ts). */
function apiSign(body: string, t: number): string {
  const k = createHmac('sha256', Buffer.from(appKey, 'base64'))
    .update('forest:web-revalidate:v1')
    .digest();
  return `t=${t},v1=${createHmac('sha256', k).update(`${t}.${body}`).digest('hex')}`;
}

describe('verifyRevalidateSignature', () => {
  const saved = process.env.APP_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = appKey;
  });
  afterAll(() => {
    process.env.APP_ENCRYPTION_KEY = saved;
  });

  it('accepts the API signature and rejects tampering, staleness and garbage', async () => {
    const { verifyRevalidateSignature, isRevalidateTag } = await import('./revalidate-auth');
    const body = '{"tags":["product:chalk-white"]}';
    expect(verifyRevalidateSignature(apiSign(body, 2_000_000), body, 2_000_010)).toBe(true);
    expect(verifyRevalidateSignature(apiSign(body, 2_000_000), `${body} `, 2_000_010)).toBe(false);
    expect(verifyRevalidateSignature(apiSign(body, 2_000_000), body, 2_000_400)).toBe(false);
    expect(verifyRevalidateSignature(null, body, 2_000_000)).toBe(false);
    expect(verifyRevalidateSignature('t=1,v1=zz', body, 1)).toBe(false);
    expect(isRevalidateTag('seo:/p/x')).toBe(true);
    expect(isRevalidateTag(42)).toBe(false);
  });
});
