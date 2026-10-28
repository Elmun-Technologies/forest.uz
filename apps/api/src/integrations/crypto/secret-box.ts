import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for secrets at rest (integration credentials, TOTP secrets).
 * Layout: [version=1][keyId:4][iv:12][tag:16][ciphertext]. The key id lets us rotate
 * `APP_ENCRYPTION_KEY` while still decrypting rows written with a previous key.
 */
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ID_LEN = 4;

export interface Keyring {
  current: Buffer;
  previous?: Buffer[];
}

function keyId(key: Buffer): Buffer {
  return createHash('sha256').update(key).digest().subarray(0, KEY_ID_LEN);
}

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  return key;
}

/**
 * The keyring of every `SecretBox` in the API: APP_ENCRYPTION_KEY encrypts, it and
 * APP_ENCRYPTION_KEY_PREVIOUS decrypt (the envelope's key id picks the key).
 */
export function keyringFromEnv(env: {
  APP_ENCRYPTION_KEY: string;
  APP_ENCRYPTION_KEY_PREVIOUS?: readonly string[];
}): Keyring {
  return {
    current: parseKey(env.APP_ENCRYPTION_KEY),
    previous: (env.APP_ENCRYPTION_KEY_PREVIOUS ?? []).map(parseKey),
  };
}

export class SecretBox {
  private readonly keys: Map<string, Buffer>;
  private readonly current: Buffer;

  constructor(keyring: Keyring) {
    this.current = keyring.current;
    this.keys = new Map(
      [keyring.current, ...(keyring.previous ?? [])].map((k) => [keyId(k).toString('hex'), k]),
    );
  }

  encrypt(plaintext: string | Buffer, aad?: string): Buffer {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.current, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([
      Buffer.from([VERSION]),
      keyId(this.current),
      iv,
      cipher.getAuthTag(),
      ct,
    ]);
  }

  decrypt(blob: Uint8Array, aad?: string): Buffer {
    const buf = Buffer.from(blob);
    if (buf.length < 1 + KEY_ID_LEN + IV_LEN + TAG_LEN || buf[0] !== VERSION)
      throw new Error('invalid secret envelope');
    const id = buf.subarray(1, 1 + KEY_ID_LEN).toString('hex');
    const key = this.keys.get(id);
    if (!key)
      throw new Error(
        'unknown encryption key id — was APP_ENCRYPTION_KEY rotated without keeping the old key?',
      );
    const ivStart = 1 + KEY_ID_LEN;
    const iv = buf.subarray(ivStart, ivStart + IV_LEN);
    const tag = buf.subarray(ivStart + IV_LEN, ivStart + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(buf.subarray(ivStart + IV_LEN + TAG_LEN)),
      decipher.final(),
    ]);
  }

  encryptJson(value: unknown, aad?: string): Buffer {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T>(blob: Uint8Array, aad?: string): T {
    return JSON.parse(this.decrypt(blob, aad).toString('utf8')) as T;
  }

  /** True when the blob was written with an older key and should be re-encrypted. */
  needsRotation(blob: Uint8Array): boolean {
    if (blob.length === 0) return false; // nothing sealed (e.g. migrated webhook rows)
    return (
      Buffer.from(blob)
        .subarray(1, 1 + KEY_ID_LEN)
        .toString('hex') !== keyId(this.current).toString('hex')
    );
  }
}

/** Shows only the last 4 characters of a secret (docs/14). */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? '••••' : `•••• •••• ${value.slice(-4)}`;
}
