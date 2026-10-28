import { describe, expect, it } from 'vitest';
import { proxiedAssetUrl, sanitizeSnapshot, snapshotUrl, viaProxy } from './snapshot';

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

  const WEB = 'http://web:3000';

  it('snapshot URLs are storefront locale pages only (no traversal, no encodings)', () => {
    expect(snapshotUrl(WEB, '/')?.href).toBe('http://web:3000/uz');
    expect(snapshotUrl(WEB, '/p/divan-toplami')?.href).toBe('http://web:3000/uz/p/divan-toplami');
    for (const bad of [
      '/../api/settings/public',
      '/%2e%2e/api/settings/public',
      '/%252e%252e/api/x',
      '/a/..',
      '/.',
      '//evil.example',
      '/a\\..\\api',
      '/a?b',
      'katalog',
    ])
      expect(snapshotUrl(WEB, bad), bad).toBeNull();
  });

  it('proxies only /_next/static files and the image optimizer', () => {
    expect(proxiedAssetUrl(WEB, '_next/static/media/m.woff2', '?x=1')?.href).toBe(
      'http://web:3000/_next/static/media/m.woff2',
    );
    expect(
      proxiedAssetUrl(WEB, '_next/static/chunks/[root-of-the-server]__a.css', '')?.pathname,
    ).toBe('/_next/static/chunks/[root-of-the-server]__a.css');
    expect(proxiedAssetUrl(WEB, '_next/image', '?url=a&w=640&q=75')?.href).toBe(
      'http://web:3000/_next/image?url=a&w=640&q=75',
    );
    for (const bad of [
      '_next/static/%2e%2e/%2e%2e/api/settings/public',
      '_next/static/%252e%252e/api',
      '_next/static/../../api',
      '_next/static/./x',
      '_next/static//x',
      '_next/static\\..\\api',
      'api/v1/admin',
      'uz/katalog',
      '_next/data/x.json',
    ])
      expect(proxiedAssetUrl(WEB, bad, ''), bad).toBeNull();
  });

  it('replay events load storefront assets through the same-origin proxy', () => {
    const events = [
      {
        type: 4,
        timestamp: 1,
        data: { href: 'https://forest.uz/uz/checkout', width: 1, height: 1 },
      },
      {
        type: 2,
        timestamp: 2,
        data: {
          node: {
            attributes: {
              src: 'https://forest.uz/_next/image?url=a&w=640',
              href: 'https://evil.example/x',
            },
          },
        },
      },
    ];
    const out = JSON.stringify(viaProxy(events));
    expect(out).toContain('"src":"/sf/_next/image?url=a&w=640"');
    expect(out).toContain('https://evil.example/x'); // other hosts stay — the admin CSP blocks them
    expect(viaProxy([{ type: 3, timestamp: 1 }])).toEqual([{ type: 3, timestamp: 1 }]);
  });
});
