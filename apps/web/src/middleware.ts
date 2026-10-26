import { localeFromAcceptLanguage } from '@forest/contracts/core';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/**
 * `fr_session` (identified customer) is httpOnly, so client code can't see it. We mirror only its
 * presence as `fr_ident=1` (no id, no PII) so client islands like the lead popup can skip
 * identified visitors without making every page dynamic.
 */
function mirrorIdentity(req: NextRequest, res: NextResponse): NextResponse {
  const identified = req.cookies.has('fr_session');
  const flagged = req.cookies.has('fr_ident');
  if (identified && !flagged) res.cookies.set('fr_ident', '1', { path: '/', sameSite: 'lax' });
  else if (!identified && flagged) res.cookies.delete('fr_ident');
  return res;
}

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

/** Language the order was placed in (the SMS with the link was sent in it); null if unknown. */
async function orderLocale(token: string): Promise<'uz' | 'ru' | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(token)) return null;
  try {
    const res = await fetch(`${API}/v1/track/${token}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const { locale } = (await res.json()) as { locale?: unknown };
    return locale === 'uz' || locale === 'ru' ? locale : null;
  } catch {
    return null;
  }
}

export default async function middleware(req: NextRequest) {
  // The SMS tracking link `/t/<token>` stays short and locale-less; it is served by the
  // `/{locale}/t/[token]` page in: the visitor's explicit choice (cookie) → the order's
  // language → Accept-Language.
  if (req.nextUrl.pathname.startsWith('/t/')) {
    const saved = req.cookies.get('fr_locale')?.value;
    const locale =
      saved === 'uz' || saved === 'ru'
        ? saved
        : ((await orderLocale(req.nextUrl.pathname.slice(3).split('/')[0] ?? '')) ??
          localeFromAcceptLanguage(req.headers.get('accept-language')));
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${req.nextUrl.pathname}`;
    return mirrorIdentity(req, NextResponse.rewrite(url));
  }
  return mirrorIdentity(req, intl(req));
}

export const config = {
  // Skip API, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
