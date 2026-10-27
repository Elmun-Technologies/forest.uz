import 'server-only';
import type {
  Locale,
  SeoMetaPublicDto,
  SeoPublicConfigDto,
  SeoSchemaToggles,
} from '@forest/contracts';
import type { Metadata } from 'next';
import { cache } from 'react';
import { apiGetOptional } from './api';
import { siteUrl } from './seo';

/**
 * Admin SEO overrides (A9, CLAUDE.md §6). Cached fetches, dropped on demand by the API
 * (`POST /api/revalidate` with `seo:<path>` / `product:<slug>` / `seo`).
 */
export const getSeoOverride = cache(
  async (locale: Locale, path: string, productSlug?: string): Promise<SeoMetaPublicDto['meta']> => {
    const dto = await apiGetOptional<SeoMetaPublicDto>(
      `/seo/meta?path=${encodeURIComponent(path)}&locale=${locale}`,
      locale,
      {
        revalidate: 300,
        tags: ['seo', `seo:${path}`, ...(productSlug ? [`product:${productSlug}`] : [])],
      },
    );
    return dto?.meta ?? null;
  },
);

const ALL_ON: SeoSchemaToggles = {
  product: true,
  organization: true,
  breadcrumb: true,
  faq: true,
  howTo: false,
  video: false,
};

/** schema.org toggles (A9); API down → the documented defaults. */
export const getSchemaToggles = cache(async (locale: Locale): Promise<SeoSchemaToggles> => {
  const dto = await apiGetOptional<SeoPublicConfigDto>('/seo/public', locale, {
    revalidate: 300,
    tags: ['seo'],
  });
  return dto?.schema ?? ALL_ON;
});

/**
 * Applies an override on top of the page's template metadata: title is absolute (the full SERP
 * title), blank fields keep the template, noindex keeps following links, a canonical override
 * replaces the self canonical (hreflang alternates stay).
 */
export function withSeoOverride(base: Metadata, meta: SeoMetaPublicDto['meta']): Metadata {
  if (!meta) return base;
  const out: Metadata = { ...base };
  if (meta.title) out.title = { absolute: meta.title };
  if (meta.description) out.description = meta.description;
  if (meta.title || meta.description || meta.ogImage) {
    out.openGraph = {
      ...(base.openGraph ?? {}),
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.ogImage
        ? {
            images: [
              {
                url: meta.ogImage.url,
                width: meta.ogImage.width ?? undefined,
                height: meta.ogImage.height ?? undefined,
              },
            ],
          }
        : {}),
    };
  }
  if (meta.noindex) out.robots = { index: false, follow: true };
  if (meta.canonical) {
    const canonical = meta.canonical.startsWith('/')
      ? `${siteUrl()}${meta.canonical}`
      : meta.canonical;
    out.alternates = { ...(base.alternates ?? {}), canonical };
  }
  return out;
}
