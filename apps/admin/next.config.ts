import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Admin CSP: everything first-party. Session replays and the A3 page backdrop render recorded /
 * fetched storefront DOM inside admin frames; with `'self'` only (+ the public media bucket) that
 * markup can't beacon anywhere — storefront assets come through the same-origin `/sf` proxy.
 * Next's inline bootstrap scripts need 'unsafe-inline' (no nonces); dev adds eval + HMR sockets.
 * Baked at build time like the rewrites (S3_PUBLIC_URL is a Docker build arg).
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== 'production';
  let media = '';
  try {
    media = new URL(process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/forest-public').origin;
  } catch {
    media = '';
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `media-src 'self' blob: ${media}`.trim(),
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repo root into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@forest/ui'],
  // Browser → API through the admin origin, so the `fr_admin` session cookie is first-party,
  // host-only and SameSite=Strict. Baked in at build time (API_INTERNAL_URL is a Docker build arg).
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/v1/:path*` }];
  },
  async headers() {
    // Admin is never embeddable or indexable.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default config;
