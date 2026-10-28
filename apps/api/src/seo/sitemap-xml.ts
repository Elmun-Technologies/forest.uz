import { LOCALES, type Locale } from '@forest/contracts';

export interface SitemapEntry {
  /** Locale-less path (`/`, `/p/x`). */
  path: string;
  locales: Locale[];
  lastmod: Date | null;
}

const URLSET_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';

export type SitemapGroup = 'pages' | 'categories' | 'products';
export const SITEMAP_GROUPS: readonly SitemapGroup[] = ['pages', 'categories', 'products'];

export interface SitemapBuild {
  /** File name → XML (`sitemap.xml` is the index). */
  files: Map<string, string>;
  counts: { name: string; urls: number }[];
  urls: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const localized = (site: string, l: Locale, path: string) =>
  `${site}/${l}${path === '/' ? '' : path}`;

/**
 * docs/10: sitemap index + one file per locale × type; every URL lists its uz/ru alternates and
 * x-default (uz). Excluded (noindex / foreign canonical) page-locales are left out by the caller.
 */
export function buildSitemaps(
  siteUrl: string,
  groups: Record<SitemapGroup, SitemapEntry[]>,
): SitemapBuild {
  const site = siteUrl.replace(/\/$/, '');
  const files = new Map<string, string>();
  const counts: { name: string; urls: number }[] = [];
  const index: { loc: string; lastmod: Date | null }[] = [];

  for (const l of LOCALES) {
    for (const group of SITEMAP_GROUPS) {
      const entries = groups[group].filter((e) => e.locales.includes(l));
      const name = `${l}-${group}.xml`;
      if (entries.length === 0) {
        // Stored too (a request for it must not trigger a rebuild); not listed in the index.
        files.set(name, `${URLSET_OPEN}\n</urlset>\n`);
        continue;
      }
      const body = entries
        .map((e) => {
          const alternates = [
            ...e.locales.map((a) => [a, localized(site, a, e.path)] as const),
            [
              'x-default',
              localized(site, e.locales.includes('uz') ? 'uz' : e.locales[0]!, e.path),
            ] as const,
          ]
            .map(
              ([hl, href]) => `<xhtml:link rel="alternate" hreflang="${hl}" href="${esc(href)}"/>`,
            )
            .join('');
          const lastmod = e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : '';
          return `<url><loc>${esc(localized(site, l, e.path))}</loc>${lastmod}${alternates}</url>`;
        })
        .join('\n');
      files.set(name, `${URLSET_OPEN}\n${body}\n</urlset>\n`);
      counts.push({ name, urls: entries.length });
      const lastmod = entries.reduce<Date | null>(
        (m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m),
        null,
      );
      index.push({ loc: `${site}/sitemaps/${name}`, lastmod });
    }
  }
  files.set(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${index
      .map(
        (i) =>
          `<sitemap><loc>${esc(i.loc)}</loc>${i.lastmod ? `<lastmod>${i.lastmod.toISOString()}</lastmod>` : ''}</sitemap>`,
      )
      .join('\n')}\n</sitemapindex>\n`,
  );
  return { files, counts, urls: counts.reduce((s, c) => s + c.urls, 0) };
}
