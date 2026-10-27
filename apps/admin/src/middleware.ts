import type { NextRequest } from 'next/server';
import { forwardToApi } from './lib/edge-proxy';

export function middleware(req: NextRequest) {
  return forwardToApi(req);
}

export const config = {
  // Only the `/api/*` → API rewrite (edge header for the client IP, CLAUDE.md §6).
  matcher: ['/api/:path*'],
};
