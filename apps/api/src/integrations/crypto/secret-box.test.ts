import { randomBytes } from 'node:crypto';
import { loadEnv } from '../../config/env';
import { keyringFromEnv, maskSecret, parseKey, SecretBox } from './secret-box';

describe('SecretBox (AES-256-GCM)', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it('round-trips JSON and never stores plaintext', () => {
    const box = new SecretBox({ current: k1 });
    const blob = box.encryptJson({ key: 'paycom-secret-123' }, 'payme');
    expect(blob.toString('utf8')).not.toContain('paycom-secret-123');
    expect(box.decryptJson(blob, 'payme')).toEqual({ key: 'paycom-secret-123' });
  });

  it('uses a random IV (same input → different ciphertext)', () => {
    const box = new SecretBox({ current: k1 });
    expect(box.encrypt('x').equals(box.encrypt('x'))).toBe(false);
  });

  it('detects tampering and wrong AAD', () => {
    const box = new SecretBox({ current: k1 });
    const blob = box.encrypt('secret', 'click');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => box.decrypt(tampered, 'click')).toThrow();
    expect(() => box.decrypt(blob, 'payme')).toThrow();
    expect(() => box.decrypt(Buffer.from([9, 9, 9]))).toThrow('invalid secret envelope');
  });

  it('supports key rotation', () => {
    const old = new SecretBox({ current: k1 });
    const blob = old.encrypt('v');
    const rotated = new SecretBox({ current: k2, previous: [k1] });
    expect(rotated.decrypt(blob).toString()).toBe('v');
    expect(rotated.needsRotation(blob)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('v'))).toBe(false);
    expect(() => new SecretBox({ current: k2 }).decrypt(blob)).toThrow('unknown encryption key id');
  });

  it('builds the keyring from APP_ENCRYPTION_KEY + APP_ENCRYPTION_KEY_PREVIOUS', () => {
    const k3 = randomBytes(32);
    const base = {
      DATABASE_URL: 'postgresql://x@localhost/forest',
      SESSION_SECRET: 'x'.repeat(32),
      APP_ENCRYPTION_KEY: k2.toString('base64'),
    };
    expect(loadEnv(base).APP_ENCRYPTION_KEY_PREVIOUS).toEqual([]);
    expect(
      loadEnv({ ...base, APP_ENCRYPTION_KEY_PREVIOUS: '' }).APP_ENCRYPTION_KEY_PREVIOUS,
    ).toEqual([]);
    const env = loadEnv({
      ...base,
      APP_ENCRYPTION_KEY_PREVIOUS: ` ${k1.toString('base64')} , ${k3.toString('base64')}`,
    });
    const box = new SecretBox(keyringFromEnv(env));
    expect(box.decrypt(new SecretBox({ current: k1 }).encrypt('a', 'x'), 'x').toString()).toBe('a');
    expect(box.decrypt(new SecretBox({ current: k3 }).encrypt('b', 'x'), 'x').toString()).toBe('b');
    // New envelopes always use the current key.
    expect(new SecretBox({ current: k2 }).decrypt(box.encrypt('c')).toString()).toBe('c');
    expect(box.needsRotation(new Uint8Array(0))).toBe(false);
    expect(() => loadEnv({ ...base, APP_ENCRYPTION_KEY_PREVIOUS: 'c2hvcnQ=' })).toThrow(
      /APP_ENCRYPTION_KEY_PREVIOUS/,
    );
  });

  it('parses keys and masks secrets', () => {
    expect(parseKey(k1.toString('base64')).length).toBe(32);
    expect(() => parseKey('c2hvcnQ=')).toThrow();
    expect(maskSecret('fr_live_abcdef3c0d')).toBe('•••• •••• 3c0d');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('')).toBeNull();
  });
});
