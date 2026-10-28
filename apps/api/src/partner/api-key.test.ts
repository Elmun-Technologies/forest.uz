import { describe, expect, it } from 'vitest';
import {
  apiKeyMatches,
  apiKeyPrefix,
  extractApiKey,
  hashApiKey,
  maskApiKey,
  newApiKey,
} from './api-key';

describe('partner api keys', () => {
  it('generates unique, well-formed keys whose hash matches', () => {
    const a = newApiKey();
    const b = newApiKey();
    expect(a.key).toMatch(/^fk_live_[a-z2-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(apiKeyPrefix(a.key)).toBe(a.prefix);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toHaveLength(64);
    expect(a.key.endsWith(a.last4)).toBe(true);
  });

  it('matches in constant time only the exact key', () => {
    const k = newApiKey();
    expect(apiKeyMatches(k.key, k.hash)).toBe(true);
    expect(apiKeyMatches(`${k.key.slice(0, -1)}x`, k.hash)).toBe(false);
    expect(apiKeyMatches(k.key, 'abc')).toBe(false);
  });

  it('rejects malformed keys before any lookup', () => {
    for (const bad of [
      '',
      'fk_live_',
      'fk_test_abcdefgh_' + 'a'.repeat(43),
      'fk_live_ABCDEFGH_' + 'a'.repeat(43),
      'fk_live_abcdefgh_short',
    ])
      expect(apiKeyPrefix(bad)).toBeNull();
  });

  it('never shows the secret in masks', () => {
    const k = newApiKey();
    const m = maskApiKey(k.prefix, k.last4);
    expect(m).toBe(`fk_live_${k.prefix}_••••${k.last4}`);
    expect(m).not.toContain(k.key.slice(17, 40));
  });

  it('reads Bearer and X-Api-Key headers', () => {
    expect(extractApiKey({ authorization: 'Bearer abc' })).toBe('abc');
    expect(extractApiKey({ 'x-api-key': ' abc ' })).toBe('abc');
    expect(extractApiKey({ authorization: 'Basic abc' })).toBeNull();
    expect(extractApiKey({})).toBeNull();
  });
});
