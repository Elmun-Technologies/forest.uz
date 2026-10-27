import type { Locale } from '@forest/contracts';
import type { Metadata } from 'next';

/**
 * hreflang uz/ru + x-default (uz) and a self canonical (docs/10). `path` is locale-less and may
 * include a query (e.g. `/katalog?page=2`).
 */
export function alternates(locale: Locale, path: string): Metadata['alternates'] {
  const p = path === '/' ? '' : path;
  return {
    canonical: `/${locale}${p}`,
    languages: { uz: `/uz${p}`, ru: `/ru${p}`, 'x-default': `/uz${p}` },
  };
}

export function siteUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function absoluteUrl(locale: Locale, path: string): string {
  return `${siteUrl()}/${locale}${path === '/' ? '' : path}`;
}

/** Trims long descriptions to the ≤160 chars search engines show. */
export function metaDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}
