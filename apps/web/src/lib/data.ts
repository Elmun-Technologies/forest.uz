import 'server-only';
import type { CategoryDto, HomeContentDto, Locale, PublicSettingsDto } from '@forest/contracts';
import { cache } from 'react';
import { apiGetOptional } from './api';

/**
 * Shared, request-deduplicated loaders for data several components need (layout + page).
 * Shared data is ISR-cached; nothing here is personal.
 */
export const getSettings = cache((locale: Locale) =>
  apiGetOptional<PublicSettingsDto>('/settings/public', locale, {
    revalidate: 60,
    tags: ['settings'],
  }),
);

export const getCategories = cache(
  async (locale: Locale) =>
    (await apiGetOptional<CategoryDto[]>('/catalog/categories', locale, { tags: ['catalog'] })) ??
    [],
);

/** `null` until GET /v1/content/home exists → pages fall back to catalog data. */
export const getHomeContent = cache((locale: Locale) =>
  apiGetOptional<HomeContentDto>('/content/home', locale, { revalidate: 60, tags: ['content'] }),
);
