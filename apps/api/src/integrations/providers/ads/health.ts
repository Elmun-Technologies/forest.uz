import type { HttpClient } from '../../http-client';
import type { HealthResult } from '../types';
import { GoogleAdsProvider } from './google-ads';
import { MetaAdsProvider } from './meta';
import { TiktokAdsProvider } from './tiktok';
import { YandexAudienceProvider } from './yandex-audience';

/** Integrations (A10) whose credentials the ad adapters use. */
export const AD_INTEGRATION_KEYS = [
  'meta_capi',
  'google_ads',
  'tiktok_pixel',
  'yandex_audience',
] as const;
export type AdIntegrationKey = (typeof AD_INTEGRATION_KEYS)[number];

export const isAdIntegration = (key: string): key is AdIntegrationKey =>
  (AD_INTEGRATION_KEYS as readonly string[]).includes(key);

/** Real adapter of an ad integration from decrypted credentials. */
export function adAdapter(key: AdIntegrationKey, c: Record<string, string>, http: HttpClient) {
  switch (key) {
    case 'meta_capi':
      return new MetaAdsProvider(c, { http });
    case 'google_ads':
      return new GoogleAdsProvider(c, { http });
    case 'tiktok_pixel':
      return new TiktokAdsProvider(c, { http });
    case 'yandex_audience':
      return new YandexAudienceProvider(c, { http });
  }
}

/** Connection test for the A10 "Tekshirish" button / connect. */
export function adsHealth(
  key: AdIntegrationKey,
  credentials: Record<string, string>,
  http: HttpClient,
): Promise<HealthResult> {
  return adAdapter(key, credentials, http).test();
}
