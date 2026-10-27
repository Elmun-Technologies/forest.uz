import { type NextRequest, NextResponse } from 'next/server';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export const dynamic = 'force-dynamic';

/**
 * `/tg?s=<source>` — the site's Telegram buttons (CLAUDE.md §6, 5A). The API stores the source and
 * this browser's visitor id behind a signed start payload, so the bot can tie the lead to the
 * visit; then 302 to `t.me/<bot>?start=<payload>`. Without the API, the plain bot link.
 */
export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('s') ?? 'site';
  const bot = req.nextUrl.searchParams.get('b') ?? '';
  const source = /^[a-z0-9_]{1,16}$/.test(src) ? src : 'site';
  let url: string | null = null;
  try {
    const res = await fetch(`${API}/v1/bot/start-link`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') ?? '',
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({ src: source }),
    });
    if (res.ok) url = ((await res.json()) as { url?: string | null }).url ?? null;
  } catch {
    // fall back below
  }
  if (!url || !url.startsWith('https://t.me/'))
    url = /^[A-Za-z0-9_]{5,32}$/.test(bot) ? `https://t.me/${bot}?start=${source}` : '/';
  const out = NextResponse.redirect(new URL(url, req.nextUrl.origin), 302);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}
