import { localeFromAcceptLanguage } from '@forest/contracts/core';
import { type NextRequest, NextResponse } from 'next/server';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export const dynamic = 'force-dynamic';

/**
 * `/c/<token>` — cart restore links from the Telegram bot / reminder SMS (CLAUDE.md §6, 5A). The
 * API checks the signature and copies the lines into this browser's cart (its `Set-Cookie`, e.g.
 * `fr_cart`, is passed through); then checkout opens. A bad or expired link lands on the cart page.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const saved = req.cookies.get('fr_locale')?.value;
  let locale =
    saved === 'uz' || saved === 'ru'
      ? saved
      : localeFromAcceptLanguage(req.headers.get('accept-language'));
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
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}
