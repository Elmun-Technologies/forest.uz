import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API, Next internals, static files and the locale-less tracking page `/t/[token]`.
  matcher: ['/((?!api|_next|_vercel|t/|.*\\..*).*)'],
};
