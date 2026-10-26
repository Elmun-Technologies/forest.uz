import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/**
 * `fr_session` (identified customer) is httpOnly, so client code can't see it. We mirror only its
 * presence as `fr_ident=1` (no id, no PII) so client islands like the lead popup can skip
 * identified visitors without making every page dynamic.
 */
export default function middleware(req: NextRequest) {
  const res = intl(req);
  const identified = req.cookies.has('fr_session');
  const flagged = req.cookies.has('fr_ident');
  if (identified && !flagged) res.cookies.set('fr_ident', '1', { path: '/', sameSite: 'lax' });
  else if (!identified && flagged) res.cookies.delete('fr_ident');
  return res;
}

export const config = {
  // Skip API, Next internals, static files and the locale-less tracking page `/t/[token]`.
  matcher: ['/((?!api|_next|_vercel|t/|.*\\..*).*)'],
};
