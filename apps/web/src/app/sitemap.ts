import type { SitemapDataDto } from '@forest/contracts';
import { type Locale, LOCALES } from '@forest/contracts/core';
import type { MetadataRoute } from 'next';
import { routes } from '@/config/site';
import { siteUrl } from '@/lib/seo';

// Rendered per request (data-cached 5 min): a build must never depend on a live API, and a
// sitemap baked at build time would miss products published afterwards.
export const dynamic = 'force-dynamic';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

type Entry = MetadataRoute.Sitemap[number];

/** One entry per locale with uz/ru/x-default alternates (docs/10). */
function localized(
  path: string,
  lastModified?: string | null,
  locales: readonly Locale[] = LOCALES,
): Entry[] {
  const base = siteUrl();
  const p = path === '/' ? '' : path;
  const languages = Object.fromEntries([
    ...locales.map((l) => [l, `${base}/${l}${p}`]),
    ['x-default', `${base}/${locales.includes('uz') ? 'uz' : locales[0]}${p}`],
  ]);
  return locales.map((l) => ({
    url: `${base}/${l}${p}`,
    lastModified: lastModified ? new Date(lastModified) : undefined,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let data: SitemapDataDto | null = null;
  try {
    const res = await fetch(`${API}/v1/seo/sitemap-data`, { next: { revalidate: 300 } });
    if (res.ok) data = (await res.json()) as SitemapDataDto;
  } catch {
    // API down → static pages only; crawlers retry later.
  }
  return [
    ...localized(routes.home),
    ...localized(routes.catalog),
    ...(data?.categories.flatMap((c) => localized(routes.category(c.slug), c.updatedAt)) ?? []),
    ...(data?.products.flatMap((p) => localized(routes.product(p.slug), p.updatedAt)) ?? []),
    // Legal pages live at the site root (`/oferta`); articles arrive with Ilhom (v1.1).
    ...(data?.pages
      .filter((p) => p.kind === 'LEGAL' && p.locales.length)
      .flatMap((p) => localized(`/${p.slug}`, p.updatedAt, p.locales)) ?? []),
  ];
}
