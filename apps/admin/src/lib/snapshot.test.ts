import { describe, expect, it } from 'vitest';
import { isProxiedAsset, isSnapshotPath, sanitizeSnapshot } from './snapshot';

describe('heatmap snapshot sanitizer', () => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/_next/static/css/a.css">
<link rel="preload" as="script" href="/_next/static/chunks/x.js">
<link rel="modulepreload" href="/_next/static/chunks/y.js">
<style>@font-face{src:url(/_next/static/media/m.woff2)}</style>
<script src="/_next/static/chunks/main.js" async=""></script>
</head><body><img srcset="/_next/image?url=a&w=640 640w, /_next/image?url=a&w=750 750w" src="/_next/image?url=a&w=750">
<script>self.__next_f.push([1,"/_next/x"])</script><iframe src="https://oauth.telegram.org"></iframe>
<a href="/uz/katalog">Katalog</a></body></html>`;
  const out = sanitizeSnapshot(html);

  it('drops every script, script preload and iframe', () => {
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('modulepreload');
    expect(out).not.toContain('as="script"');
    expect(out).not.toContain('<iframe');
  });

  it("points /_next assets at the admin's proxy", () => {
    expect(out).toContain('href="/sf/_next/static/css/a.css"');
    expect(out).toContain('url(/sf/_next/static/media/m.woff2)');
    expect(out).toContain(
      'srcset="/sf/_next/image?url=a&w=640 640w, /sf/_next/image?url=a&w=750 750w"',
    );
    expect(out).not.toMatch(/["'(\s,]\/_next\//);
    expect(out).toContain('href="/uz/katalog"');
  });

  it('adds a script-src none CSP right after <head>', () => {
    expect(out).toMatch(
      /<head><meta http-equiv="Content-Security-Policy" content="script-src 'none'/,
    );
  });

  it('accepts storefront paths and proxied assets only', () => {
    expect(isSnapshotPath('/')).toBe(true);
    expect(isSnapshotPath('/p/divan-toplami')).toBe(true);
    expect(isSnapshotPath('/../admin')).toBe(false);
    expect(isSnapshotPath('//evil.example')).toBe(false);
    expect(isSnapshotPath('/a?b')).toBe(false);
    expect(isProxiedAsset('_next/static/media/m.woff2')).toBe(true);
    expect(isProxiedAsset('_next/image')).toBe(true);
    expect(isProxiedAsset('api/v1/admin')).toBe(false);
    expect(isProxiedAsset('_next/static/../../etc')).toBe(false);
    expect(isProxiedAsset('uz/katalog')).toBe(false);
  });
});
