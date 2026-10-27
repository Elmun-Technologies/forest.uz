import path from 'node:path';
import type { NextConfig } from 'next';

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
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default config;
