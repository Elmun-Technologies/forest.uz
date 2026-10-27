import { localeFromAcceptLanguage } from '@forest/contracts/core';
import { type NextRequest, NextResponse } from 'next/server';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export const dynamic = 'force-dynamic';

type Locale = 'uz' | 'ru';

const TEXT: Record<Locale, { title: string; button: string }> = {
  uz: { title: 'Savatingizni tiklaymizmi?', button: 'Savatni tiklash' },
  ru: { title: 'Восстановить вашу корзину?', button: 'Восстановить корзину' },
};

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

function browserLocale(req: NextRequest): Locale {
  const saved = req.cookies.get('fr_locale')?.value;
  return saved === 'uz' || saved === 'ru'
    ? saved
    : localeFromAcceptLanguage(req.headers.get('accept-language'));
}

/** The API copies the link's lines into this browser's cart; then checkout opens. */
async function restore(req: NextRequest, token: string): Promise<NextResponse> {
  const saved = req.cookies.get('fr_locale')?.value;
  let locale = browserLocale(req);
  let target = `/${locale}/savat`;
  const cookies: string[] = [];
  try {
    const res = await fetch(`${API}/v1/cart/restore`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') ?? '',
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
        'accept-language': req.headers.get('accept-language') ?? '',
      },
      body: JSON.stringify({ token }),
    });
    cookies.push(...res.headers.getSetCookie());
    if (res.ok) {
      const body = (await res.json()) as {
        restored?: number;
        locale?: string | null;
        campaign?: string | null;
      };
      if (!saved && (body.locale === 'uz' || body.locale === 'ru')) locale = body.locale;
      if (body.restored) {
        const url = new URL(`/${locale}/checkout`, req.nextUrl.origin);
        url.searchParams.set('utm_source', 'telegram');
        url.searchParams.set('utm_medium', 'bot');
        url.searchParams.set('utm_campaign', body.campaign ?? 'cart_restore');
        target = `${url.pathname}${url.search}`;
      } else target = `/${locale}/savat`;
    }
  } catch {
    // API unreachable: the cart page still works with whatever the browser has.
  }
  const out = NextResponse.redirect(new URL(target, req.nextUrl.origin), 303);
  for (const c of cookies) out.headers.append('Set-Cookie', c);
  return noStore(out);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * `/c/<token>` — cart restore links from the Telegram bot / reminder SMS (CLAUDE.md §6, 5A).
 * Restoring changes the browser's cart, so a GET does it only for a top-level navigation
 * (`Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document`: tapping the link). Anything else —
 * a cross-site `<img>`/iframe, link-preview robots, browsers without Fetch Metadata — gets a
 * small confirm page whose button POSTs back here.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const mode = req.headers.get('sec-fetch-mode');
  const dest = req.headers.get('sec-fetch-dest');
  if (mode === 'navigate' && dest === 'document') return restore(req, token);
  const t = TEXT[browserLocale(req)];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Forest</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#EDEDE8;color:#141712"><form method="post" style="background:#fff;border-radius:16px;padding:32px;text-align:center"><p style="font-size:18px;margin:0 0 20px">${escape(t.title)}</p><button type="submit" style="background:#141712;color:#fff;border:0;border-radius:999px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer">${escape(t.button)}</button></form></body></html>`;
  return noStore(
    new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  );
}

/**
 * The confirm page's button: same-origin form posts only (Fetch Metadata, else the `Origin` host
 * must be this request's host — behind Caddy the Host header is the public one).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let sameOrigin = site === 'same-origin';
  if (!site) {
    try {
      sameOrigin = !origin || new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) return noStore(new NextResponse(null, { status: 403 }));
  return restore(req, token);
}
