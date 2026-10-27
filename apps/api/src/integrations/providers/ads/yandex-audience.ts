import type { HttpClient } from '../../http-client';
import type { HealthResult } from '../types';
import { AdPlatformError, type AudienceListProvider, platformError } from './types';

/**
 * Yandex Audience management API (docs/runbooks/ads.md; official reference pages known only by
 * search snippets — `segments/uploadCsvFile`, `segments/modifyUploadingData`, data requirements;
 * clients: ssheremeta/yandex-audience-api @d917f9e (Python), nikon72ru/yandex-audience-api
 * @589b513 (Go)):
 * - `POST /v1/management/segments/upload_csv_file` (multipart `file`) → `segment.id`, then
 *   `POST /v1/management/segment/{id}/confirm` `{segment: {id, name, hashed: true, content_type: 'crm'}}`;
 * - `POST /v1/management/segment/{id}/modify_data?modification_type=addition|subtraction`;
 * - `Authorization: OAuth <token>`.
 * Hashes: SHA-256 (MD5 no longer accepted for new data since 2025 per the help page), phone =
 * digits with country code. CSV column `phone`.
 */
export const YANDEX_AUDIENCE_URL = 'https://api-audience.yandex.ru/v1/management';

export interface YandexAudienceCredentials {
  oauthToken?: string;
}

interface Deps {
  http: HttpClient;
  baseUrl?: string;
}

export class YandexAudienceProvider implements AudienceListProvider {
  readonly destination = 'yandex' as const;
  private readonly base: string;

  constructor(
    private readonly c: YandexAudienceCredentials,
    private readonly deps: Deps,
  ) {
    this.base = (deps.baseUrl ?? YANDEX_AUDIENCE_URL).replace(/\/+$/, '');
  }

  private async call(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: string | Uint8Array; type?: string } = {},
  ) {
    if (!this.c.oauthToken) throw new AdPlatformError('oauthToken is required');
    const res = await this.deps.http.request({
      method: init.method ?? 'POST',
      url: `${this.base}${path}`,
      headers: {
        Authorization: `OAuth ${this.c.oauthToken}`,
        ...(init.type ? { 'Content-Type': init.type } : {}),
      },
      body: init.body,
      timeoutMs: 30_000,
    });
    if (res.status < 200 || res.status >= 300)
      throw new AdPlatformError(platformError(res.status, res.text));
    return JSON.parse(res.text || '{}') as { segment?: { id?: number | string } };
  }

  private csv(hashes: string[]): { body: Uint8Array; type: string } {
    const boundary = `forest${Date.now().toString(16)}`;
    const file = `phone\n${hashes.join('\n')}\n`;
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="forest.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n${file}\r\n--${boundary}--\r\n`;
    return {
      body: new Uint8Array(Buffer.from(body, 'utf8')),
      type: `multipart/form-data; boundary=${boundary}`,
    };
  }

  async test(): Promise<HealthResult> {
    try {
      await this.call('/segments', { method: 'GET' });
      return { ok: true, message: 'segments list ok' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async create(name: string, hashes: string[]): Promise<string> {
    const uploaded = await this.call('/segments/upload_csv_file', this.csv(hashes));
    const id = uploaded.segment?.id;
    if (id === undefined) throw new AdPlatformError('upload_csv_file: no segment id');
    await this.call(`/segment/${encodeURIComponent(String(id))}/confirm`, {
      body: JSON.stringify({
        segment: { id: Number(id), name: name.slice(0, 250), hashed: true, content_type: 'crm' },
      }),
      type: 'application/json',
    });
    return String(id);
  }

  private async modify(id: string, type: 'addition' | 'subtraction', hashes: string[]) {
    if (!hashes.length) return;
    await this.call(
      `/segment/${encodeURIComponent(id)}/modify_data?modification_type=${type}`,
      this.csv(hashes),
    );
  }

  add(id: string, hashes: string[]): Promise<void> {
    return this.modify(id, 'addition', hashes);
  }

  remove(id: string, hashes: string[]): Promise<void> {
    return this.modify(id, 'subtraction', hashes);
  }
}
