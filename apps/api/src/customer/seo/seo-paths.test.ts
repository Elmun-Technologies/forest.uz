import { MAX_PATH, normalizePath, normalizeReferrer, redirectCandidates } from './seo-paths';

describe('normalizePath', () => {
  it('keeps the path only', () => {
    expect(normalizePath('/uz/p/old?utm_source=x&t=secret#top')).toBe('/uz/p/old');
    expect(normalizePath('https://forest.uz/ru/katalog?page=2')).toBe('/ru/katalog');
    expect(normalizePath('  /uz//p///x ')).toBe('/uz/p/x');
  });

  it('rejects non-paths', () => {
    expect(normalizePath('uz/p/x')).toBeNull();
    expect(normalizePath('//evil.com/x')).toBeNull();
    expect(normalizePath('/a b')).toBeNull();
    expect(normalizePath('/a\\b')).toBeNull();
    expect(normalizePath('javascript:alert(1)')).toBeNull();
    expect(normalizePath('')).toBeNull();
  });

  it('caps length', () => {
    expect(normalizePath(`/${'a'.repeat(2000)}`)).toHaveLength(MAX_PATH);
  });
});

describe('redirectCandidates', () => {
  it('tries both trailing-slash forms', () => {
    expect(redirectCandidates('/uz/old')).toEqual(['/uz/old', '/uz/old/']);
    expect(redirectCandidates('/uz/old/')).toEqual(['/uz/old/', '/uz/old']);
    expect(redirectCandidates('/')).toEqual(['/']);
  });
});

describe('normalizeReferrer', () => {
  it('strips query strings and rejects non-http referrers', () => {
    expect(normalizeReferrer('https://www.google.com/search?q=kraska')).toBe(
      'https://www.google.com/search',
    );
    expect(normalizeReferrer('android-app://org.telegram.messenger/')).toBeNull();
    expect(normalizeReferrer('not a url')).toBeNull();
    expect(normalizeReferrer(null)).toBeNull();
  });
});
