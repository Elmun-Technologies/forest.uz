import { LOCALES } from '@forest/contracts';
import { PRIVATE_ROUTES } from './seo-inventory.service';

/**
 * Generated robots.txt (used while A9 has no custom text): personal and transactional pages stay
 * out of the index (they are also `noindex`); the sitemap index is announced.
 */
export function defaultRobots(siteUrl: string): string {
  const disallow = [
    '/api/',
    '/t/',
    ...PRIVATE_ROUTES.flatMap((p) => LOCALES.map((l) => `/${l}${p}`)),
  ];
  return [
    'User-Agent: *',
    'Allow: /',
    ...disallow.map((d) => `Disallow: ${d}`),
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

/** Admin text as served: normalised line endings, one trailing newline. */
export function normalizeRobots(text: string): string {
  return `${text.replace(/\r\n?/g, '\n').trimEnd()}\n`;
}
