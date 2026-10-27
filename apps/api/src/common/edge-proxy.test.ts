import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { edgeProxyGate } from './edge-proxy';

const SECRET = 's'.repeat(40);

function run(headers: Record<string, string>): IncomingMessage['headers'] {
  const req = { headers: { ...headers } } as unknown as IncomingMessage;
  let called = false;
  edgeProxyGate(SECRET)(req, null, () => {
    called = true;
  });
  expect(called).toBe(true);
  return req.headers;
}

describe('edgeProxyGate', () => {
  it('keeps the forwarded chain of edge-proxied requests and drops the secret header', () => {
    const h = run({ 'x-forest-edge': SECRET, 'x-forwarded-for': '203.0.113.7, 76.76.21.1' });
    expect(h['x-forwarded-for']).toBe('203.0.113.7, 76.76.21.1');
    expect(h['x-forest-edge']).toBeUndefined();
  });

  it('reduces a direct (or wrong-secret) request to the peer the platform proxy appended', () => {
    expect(run({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' })['x-forwarded-for']).toBe(
      '198.51.100.9',
    );
    const wrong = run({ 'x-forest-edge': 'nope', 'x-forwarded-for': '1.2.3.4, 198.51.100.9' });
    expect(wrong['x-forwarded-for']).toBe('198.51.100.9');
    expect(wrong['x-forest-edge']).toBeUndefined();
    expect(run({ 'x-forwarded-for': '198.51.100.9' })['x-forwarded-for']).toBe('198.51.100.9');
  });
});
