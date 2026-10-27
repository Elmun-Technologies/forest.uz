import type { HttpClient } from '../http-client';
import {
  GoogleSearchConsoleSource,
  type SearchQuerySource,
  YandexWebmasterSource,
} from './seo-search';
import { PageSpeedInsights } from './seo-tools';
import type { HealthResult } from './types';

/** Real SEO adapters from decrypted credentials (`gsc`, `ywm`, `pagespeed` Integration rows). */
export function searchQuerySource(
  key: 'gsc' | 'ywm',
  creds: Record<string, string>,
  http: HttpClient,
): SearchQuerySource {
  return key === 'gsc'
    ? new GoogleSearchConsoleSource(creds, http)
    : new YandexWebmasterSource(creds, http);
}

/** Connect/test from the integrations hub. */
export function seoProviderTest(
  key: 'gsc' | 'ywm' | 'pagespeed',
  creds: Record<string, string>,
  http: HttpClient,
): Promise<HealthResult> {
  return key === 'pagespeed'
    ? new PageSpeedInsights(creds, http).test()
    : searchQuerySource(key, creds, http).test();
}
