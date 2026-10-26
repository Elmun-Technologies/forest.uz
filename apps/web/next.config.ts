import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const publicFiles = new URL(process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/forest-public');

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repo root into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@forest/ui'],
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
