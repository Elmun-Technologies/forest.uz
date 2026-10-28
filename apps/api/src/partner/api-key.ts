import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_KEY_POLICY } from '@forest/contracts';

/**
 * Partner API key format (CLAUDE.md §6): `fk_live_<prefix 8>_<secret 43>` — the prefix is the
 * public lookup id, the secret 32 random bytes. Only sha256(full key) is stored: with 256 random
 * bits a slow password hash adds nothing.
 */
const PREFIX_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const KEY_RE = /^fk_live_([a-z2-9]{8})_([A-Za-z0-9_-]{43})$/;

export interface NewApiKey {
  key: string;
  prefix: string;
  hash: string;
  last4: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function newApiKey(): NewApiKey {
  const bytes = randomBytes(8);
  const prefix = [...bytes].map((b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join('');
  const secret = randomBytes(32).toString('base64url');
  const key = `${API_KEY_POLICY.keyPrefix}${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key), last4: secret.slice(-4) };
}

/** The lookup prefix of a well-formed key, else null (no DB hit for garbage). */
export function apiKeyPrefix(key: string): string | null {
  return KEY_RE.exec(key)?.[1] ?? null;
}

export function apiKeyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function maskApiKey(prefix: string, last4: string): string {
  return `${API_KEY_POLICY.keyPrefix}${prefix}_••••${last4}`;
}

/** `Authorization: Bearer <key>` (or `X-Api-Key`). */
export function extractApiKey(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const auth = headers.authorization;
  const bearer = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth)?.[1] : undefined;
  const x = headers['x-api-key'];
  return bearer ?? (typeof x === 'string' ? x.trim() : null) ?? null;
}
