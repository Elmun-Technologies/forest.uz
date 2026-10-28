import { createHmac } from 'node:crypto';
import { signUnsubscribe, unsubscribeUrl, verifyUnsubscribe } from './unsubscribe';

const secret = 'x'.repeat(64);

describe('unsubscribe tokens', () => {
  it('round-trips channel and customer number, short enough for an SMS', () => {
    const token = signUnsubscribe('SMS', 'C-10482', secret);
    expect(token).toMatch(/^s10482[A-Za-z0-9_-]{16}$/);
    expect(verifyUnsubscribe(token, secret)).toEqual({ channel: 'SMS', publicId: 'C-10482' });
    expect(verifyUnsubscribe(signUnsubscribe('TELEGRAM', 'C-7', secret), secret)).toEqual({
      channel: 'TELEGRAM',
      publicId: 'C-7',
    });
    expect(unsubscribeUrl('https://forest.uz/', 'uz', token)).toBe(
      `https://forest.uz/uz/obuna/${token}`,
    );
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const token = signUnsubscribe('SMS', 'C-10482', secret);
    expect(verifyUnsubscribe(token.replace('10482', '10483'), secret)).toBeNull();
    expect(verifyUnsubscribe(`t${token.slice(1)}`, secret)).toBeNull();
    expect(verifyUnsubscribe(token, 'y'.repeat(64))).toBeNull();
    expect(verifyUnsubscribe('short', secret)).toBeNull();
    expect(verifyUnsubscribe(`x10482${token.slice(-16)}`, secret)).toBeNull();
  });

  it('MACs with a key derived from the secret and still accepts first-version tokens', () => {
    const body = 's10482';
    const legacy =
      body + createHmac('sha256', secret).update(`unsub:${body}`).digest('base64url').slice(0, 16);
    const token = signUnsubscribe('SMS', 'C-10482', secret);
    expect(token).not.toBe(legacy);
    expect(verifyUnsubscribe(legacy, secret)).toEqual({ channel: 'SMS', publicId: 'C-10482' });
  });
});
