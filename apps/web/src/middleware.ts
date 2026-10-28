import { localeFromAcceptLanguage } from '@forest/contracts/core';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { forwardToApi } from './lib/edge-proxy';

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

/**
 * `fr_aid` (httpOnly visitor id, CLAUDE.md §6) is issued on the first page response, so every
 * tracker beacon already carries it: otherwise two beacons in flight on a first visit would each
 * get a new id from the API and the session would split between two visitors. Same format as
 * the API's `SessionService.ensureVisitorId` (18 random bytes, base64url).
 */
const VISITOR_TTL_SEC = 400 * 24 * 3600;
function ensureVisitor(req: NextRequest, res: NextResponse): NextResponse {
  if (/^[\w-]{10,64}$/.test(req.cookies.get('fr_aid')?.value ?? '')) return res;
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  res.cookies.set('fr_aid', id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: VISITOR_TTL_SEC,
  });
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
  if (req.nextUrl.pathname.startsWith('/api/')) return forwardToApi(req);
  // Telegram bot hand-offs are locale-less route handlers: `/c/<token>` (cart restore) and
  // `/tg?s=<src>` (bot start link) — no locale redirect (CLAUDE.md §6, 5A).
  if (req.nextUrl.pathname.startsWith('/c/') || req.nextUrl.pathname === '/tg')
    return ensureVisitor(req, NextResponse.next());
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
    return ensureVisitor(req, mirrorIdentity(req, NextResponse.rewrite(url)));
  }
  return ensureVisitor(req, mirrorIdentity(req, intl(req)));
}

export const config = {
  // Pages (not Next internals or static files) + the `/api/*` proxy (edge header only).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/api/:path*'],
};
