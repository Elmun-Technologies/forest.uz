import { DomainError } from '@forest/contracts';
import { describe, expect, it } from 'vitest';
import { resolveTarget, sitePath } from './redirects';

const lookup = (map: Record<string, string>) => async (p: string) => map[p] ?? null;

describe('resolveTarget (no chains, no loops)', () => {
  it('follows existing redirects to the final destination', async () => {
    await expect(resolveTarget('/a', '/b', lookup({ '/b': '/c', '/c': '/d' }))).resolves.toBe('/d');
    await expect(resolveTarget('/a', '/b', lookup({}))).resolves.toBe('/b');
  });

  it('refuses self-redirects and loops', async () => {
    await expect(resolveTarget('/a', '/a', lookup({}))).rejects.toMatchObject({
      code: 'REDIRECT_LOOP',
    });
    const err = await resolveTarget('/a', '/b', lookup({ '/b': '/c', '/c': '/a' })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('REDIRECT_LOOP');
  });

  it('refuses endless chains', async () => {
    const map = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`/x${i}`, `/x${i + 1}`]));
    await expect(resolveTarget('/a', '/x0', lookup(map))).rejects.toMatchObject({
      code: 'REDIRECT_LOOP',
    });
  });
});

describe('sitePath', () => {
  it('accepts same-site paths and absolute URLs on our host only', () => {
    expect(sitePath('/uz/p/x?utm=1', 'forest.uz')).toBe('/uz/p/x');
    expect(sitePath('/uz/p/x/', 'forest.uz')).toBe('/uz/p/x');
    expect(sitePath('/', 'forest.uz')).toBe('/');
    expect(sitePath('https://forest.uz/', 'forest.uz')).toBe('/');
    expect(sitePath('https://forest.uz/ru/katalog', 'forest.uz')).toBe('/ru/katalog');
    expect(sitePath('https://evil.com/ru', 'forest.uz')).toBeNull();
    expect(sitePath('//evil.com/x', 'forest.uz')).toBeNull();
    expect(sitePath('javascript:alert(1)', 'forest.uz')).toBeNull();
  });
});
