import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  maskWebhookSecret,
  newWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
} from './signature';

const secret = newWebhookSecret();
const body = JSON.stringify({ id: 'd1', type: 'order.paid', data: { number: 'F-10001' } });
const now = 1_790_000_000;

describe('webhook signature', () => {
  it('signs t.body with HMAC-SHA256 in the documented format', () => {
    const header = signWebhook(secret, body, now);
    const mac = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
    expect(header).toBe(`t=${now},v1=${mac}`);
  });

  it('verifies a fresh signature and rejects tampering', () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhookSignature(secret, header, body, now + 10)).toBe(true);
    expect(verifyWebhookSignature(secret, header, `${body} `, now)).toBe(false);
    expect(verifyWebhookSignature(newWebhookSecret(), header, body, now)).toBe(false);
  });

  it('rejects replays outside the 5 minute window (both directions)', () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhookSignature(secret, header, body, now + 300)).toBe(true);
    expect(verifyWebhookSignature(secret, header, body, now + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, now - 301)).toBe(false);
  });

  it('rejects malformed headers', () => {
    for (const h of [null, '', 'v1=abc', `t=${now}`, `t=x,v1=${'0'.repeat(64)}`, `t=${now},v1=zz`])
      expect(verifyWebhookSignature(secret, h, body, now)).toBe(false);
  });

  it('accepts any of several v1 values (rotation)', () => {
    const good = signWebhook(secret, body, now).split(',')[1];
    expect(verifyWebhookSignature(secret, `t=${now},v1=${'0'.repeat(64)},${good}`, body, now)).toBe(
      true,
    );
  });

  it('generates prefixed 256-bit secrets and masks them', () => {
    const s = newWebhookSecret();
    expect(s).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(s).not.toBe(newWebhookSecret());
    expect(maskWebhookSecret('ab12')).toBe('whsec_••••ab12');
  });
});
