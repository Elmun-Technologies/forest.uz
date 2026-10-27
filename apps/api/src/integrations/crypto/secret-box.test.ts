import { randomBytes } from 'node:crypto';
import { maskSecret, parseKey, SecretBox } from './secret-box';

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

  it('parses keys and masks secrets', () => {
    expect(parseKey(k1.toString('base64')).length).toBe(32);
    expect(() => parseKey('c2hvcnQ=')).toThrow();
    expect(maskSecret('fr_live_abcdef3c0d')).toBe('•••• •••• 3c0d');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('')).toBeNull();
  });
});
