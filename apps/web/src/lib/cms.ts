import 'server-only';
import type {
  ArticleCategory,
  ArticleDto,
  ArticleListDto,
  BrandStoryDto,
  Locale,
} from '@forest/contracts';
import { cache } from 'react';
import { ApiError, apiGet, apiGetOptional } from './api';
import { notFoundWithRedirect } from './not-found';

/**
 * Ilhom/Brend CMS reads (CLAUDE.md §6). Cached fetches dropped on demand by the API after an admin
 * save (`content`, `articles`, `page:<slug>` tags), else every 5 minutes.
 */
const REVALIDATE = 300;

export const getArticles = cache(
  (locale: Locale, category: ArticleCategory | undefined, page: number) =>
    apiGet<ArticleListDto>(
      `/content/articles?page=${page}${category ? `&category=${category}` : ''}`,
      locale,
      { revalidate: REVALIDATE, tags: ['content', 'articles'] },
    ),
);

/** The article, or the admin redirect / logged 404 for a moved or unknown slug. */
export const getArticle = cache(async (locale: Locale, slug: string): Promise<ArticleDto> => {
  try {
    return await apiGet<ArticleDto>(`/content/articles/${slug}`, locale, {
      revalidate: REVALIDATE,
      tags: ['content', 'articles', `page:${slug}`],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404)
      return notFoundWithRedirect(`/${locale}/ilhom/${slug}`);
    throw e;
  }
});

/** The CMS brand story; null until the owner publishes it (the section is then hidden). */
export const getBrandStory = cache((locale: Locale) =>
  apiGetOptional<BrandStoryDto>('/content/brand', locale, {
    revalidate: REVALIDATE,
    tags: ['content', 'page:brend'],
  }),
);
