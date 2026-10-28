import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const secret = 'x'.repeat(40);

/** Independent re-implementation of the API side (apps/api/src/seo/web-signature.ts). */
function apiSign(
  context: string,
  body: string,
  t: number,
  s: Buffer = Buffer.from(secret),
): string {
  const k = createHmac('sha256', s).update(context).digest();
  return `t=${t},v1=${createHmac('sha256', k).update(`${t}.${body}`).digest('hex')}`;
}

describe('web ↔ API signatures', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the API revalidation signature and rejects tampering, staleness, other contexts', async () => {
    vi.stubEnv('WEB_REVALIDATE_SECRET', secret);
    const { verifyWebSignature, WEB_CONTEXTS, isRevalidateTag } = await import('./web-signature');
    const body = '{"tags":["product:chalk-white"]}';
    const sig = apiSign('forest:web-revalidate:v1', body, 2_000_000);
    expect(verifyWebSignature(WEB_CONTEXTS.revalidate, sig, body, 2_000_010)).toBe(true);
    expect(verifyWebSignature(WEB_CONTEXTS.revalidate, sig, `${body} `, 2_000_010)).toBe(false);
    expect(verifyWebSignature(WEB_CONTEXTS.revalidate, sig, body, 2_000_400)).toBe(false);
    expect(verifyWebSignature(WEB_CONTEXTS.notFound, sig, body, 2_000_010)).toBe(false);
    expect(verifyWebSignature(WEB_CONTEXTS.revalidate, null, body, 2_000_000)).toBe(false);
    expect(isRevalidateTag('seo:/p/x')).toBe(true);
    expect(isRevalidateTag(42)).toBe(false);
  });

  it('signs 404 reports the way the API verifies them', async () => {
    vi.stubEnv('WEB_REVALIDATE_SECRET', secret);
    const { signWebRequest, WEB_CONTEXTS } = await import('./web-signature');
    const body = '{"path":"/uz/x","referrer":null}';
    expect(signWebRequest(WEB_CONTEXTS.notFound, body, 5)).toBe(
      apiSign('forest:seo-not-found:v1', body, 5),
    );
  });

  it('fails closed in production without the secret; dev derives it from APP_ENCRYPTION_KEY', async () => {
    const { signWebRequest, WEB_CONTEXTS } = await import('./web-signature');
    vi.stubEnv('WEB_REVALIDATE_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(signWebRequest(WEB_CONTEXTS.notFound, '{}')).toBeNull();
    vi.stubEnv('NODE_ENV', 'development');
    const appKey = Buffer.alloc(32, 7);
    vi.stubEnv('APP_ENCRYPTION_KEY', appKey.toString('base64'));
    const derived = createHmac('sha256', appKey)
      .update('forest:web-secret:dev-fallback:v1')
      .digest();
    expect(signWebRequest(WEB_CONTEXTS.notFound, '{}', 9)).toBe(
      apiSign('forest:seo-not-found:v1', '{}', 9, derived),
    );
  });
});
