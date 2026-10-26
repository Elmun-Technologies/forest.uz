import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Messages are precompiled at build time (ICU → compact AST), so the browser bundle ships the
// format-only runtime instead of the ICU parser (`IntlMessageFormat`), and formatting is cheaper.
const withNextIntl = createNextIntlPlugin({
  requestConfig: './src/i18n/request.ts',
  experimental: {
    messages: { path: './messages', format: 'json', locales: 'infer', precompile: true },
  },
});
const publicFiles = new URL(process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/forest-public');

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repo root into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@forest/ui'],
  // Metadata is resolved before the shell for every user agent instead of being streamed into
  // <body> on dynamic pages (Next's default for non-bots): title, description and canonical are
  // always in <head>, for every crawler and audit. The data is already fetched for the page.
  htmlLimitedBots: /.*/,
  experimental: {
    // The (single, Tailwind) stylesheet is inlined as <style>, so the first frame doesn't wait for a
    // CSS request that competes with the JS chunks. Otherwise hydration often starts before that
    // frame is drawn and Chrome's paint holding delays first paint by ~1 s (see CLAUDE.md §6).
    inlineCss: true,
  },
  // Browser → API goes through the shop origin so session/cart cookies are first-party and
  // readable by SSR. Server components call API_INTERNAL_URL directly, forwarding cookies.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/v1/:path*` }];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: publicFiles.protocol.replace(':', '') as 'http' | 'https',
        hostname: publicFiles.hostname,
        port: publicFiles.port,
        pathname: `${publicFiles.pathname.replace(/\/$/, '')}/**`,
      },
    ],
  },
};

export default withNextIntl(config);
