import 'server-only';
import type { RedirectDto } from '@forest/contracts';
import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { after } from 'next/server';
import { apiRequest } from './api';

/**
 * 404 with SEO hooks (docs/10): first look up an admin-managed redirect for the path (old slugs,
 * moved pages), otherwise log the miss for the SEO center's 404 report and render not-found.
 */
export async function notFoundWithRedirect(path: string): Promise<never> {
  let hit: RedirectDto | null = null;
  try {
    const res = await apiRequest(`/seo/redirect?path=${encodeURIComponent(path)}`);
    if (res.ok) hit = (await res.json()) as RedirectDto;
  } catch {
    // API down → plain 404; never fail the page because of the lookup.
  }
  if (hit && hit.to !== path) {
    if (hit.code === 301 || hit.code === 308) permanentRedirect(hit.to);
    redirect(hit.to);
  }
  const referrer = (await headers()).get('referer');
  after(async () => {
    await apiRequest('/seo/not-found', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, referrer }),
    }).catch(() => undefined);
  });
  notFound();
}
