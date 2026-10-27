import { createHash } from 'node:crypto';
import type { HttpClient } from '../../http-client';
import type { HealthResult } from '../types';
import {
  type AdConversion,
  AdPlatformError,
  type AudienceCreated,
  type AudienceListProvider,
  type ConversionProvider,
  type ConversionSendResult,
  emptyResult,
  hashPhone,
  platformError,
  sha256Hex,
} from './types';

/**
 * TikTok Business API v1.3 (docs/runbooks/ads.md; sources: tiktok/tiktok-business-api-sdk
 * @f809c39 `AudienceApi.md`, `CustomAudience{Create,Update}Body.md`; tiktok/gtm-template-eapi
 * @089e34e `template.js` (official Events API 2.0 template); stape-io/tiktok-tag @81f48a1):
 * - Events API: `POST /event/track/` `{event_source: 'web', event_source_id: pixel, data: [...]}`,
 *   header `Access-Token`; user.phone / external_id = SHA-256 hex;
 * - customer-file audiences: upload a file of hashes (`/dmp/custom_audience/file/upload/`,
 *   multipart, `calculate_type`, `file_signature` = MD5 of the file), then
 *   `/dmp/custom_audience/create/` or `/update/` with `action` APPEND | REMOVE.
 * Responses are HTTP 200 with `{code, message}`; code 0 = success.
 */
export const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

const EVENT_NAME: Record<AdConversion['name'], string> = {
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  purchase: 'CompletePayment',
  // No lead event in the template map; SubmitForm is the standard form event (open question).
  lead: 'SubmitForm',
};

const EVENTS_BATCH = 1_000;
const CALCULATE_TYPE = 'PHONE_SHA256';

export interface TiktokCredentials {
  pixelId?: string;
  accessToken?: string;
  advertiserId?: string;
  testEventCode?: string;
}

interface Deps {
  http: HttpClient;
  baseUrl?: string;
}

export function tiktokEvent(e: AdConversion): Record<string, unknown> | null {
  const user: Record<string, string> = {};
  const phone = e.phone ? hashPhone(e.phone, 'tiktok') : null;
  if (phone) user.phone = phone;
  if (e.customerId) user.external_id = sha256Hex(e.customerId);
  if (e.clickIds.ttclid) user.ttclid = e.clickIds.ttclid;
  if (Object.keys(user).length === 0) return null;
  const properties: Record<string, unknown> = { currency: 'UZS' };
  if (e.valueSoum !== null) properties.value = e.valueSoum;
  return {
    event: EVENT_NAME[e.name],
    event_time: Math.floor(e.at.getTime() / 1000),
    event_id: e.eventId,
    ...(e.url ? { page: { url: e.url } } : {}),
    user,
    properties,
  };
}

export class TiktokAdsProvider implements ConversionProvider, AudienceListProvider {
  readonly platform = 'tiktok' as const;
  readonly destination = 'tiktok' as const;
  private readonly base: string;

  constructor(
    private readonly c: TiktokCredentials,
    private readonly deps: Deps,
  ) {
    this.base = (deps.baseUrl ?? TIKTOK_API_URL).replace(/\/+$/, '');
  }

  private async call(
    path: string,
    init: { body?: string | Uint8Array; type?: string; get?: boolean },
  ) {
    if (!this.c.accessToken) throw new AdPlatformError('accessToken is required');
    const res = await this.deps.http.request({
      method: init.get ? 'GET' : 'POST',
      url: `${this.base}${path}`,
      headers: {
        'Access-Token': this.c.accessToken,
        ...(init.type ? { 'Content-Type': init.type } : {}),
      },
      body: init.body,
      timeoutMs: 20_000,
    });
    if (res.status < 200 || res.status >= 300)
      throw new AdPlatformError(platformError(res.status, res.text));
    const body = JSON.parse(res.text || '{}') as {
      code?: number;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (body.code !== 0)
      throw new AdPlatformError(`code ${body.code ?? '?'}: ${(body.message ?? '').slice(0, 200)}`);
    return body.data ?? {};
  }

  private json(path: string, payload: unknown) {
    return this.call(path, { body: JSON.stringify(payload), type: 'application/json' });
  }

  async test(): Promise<HealthResult> {
    if (!this.c.pixelId || !this.c.accessToken)
      return { ok: false, message: 'pixelId and accessToken are required' };
    if (!this.c.advertiserId)
      return { ok: true, message: 'saved; no advertiser id, so no test call (events verify it)' };
    try {
      const ids = encodeURIComponent(JSON.stringify([this.c.advertiserId]));
      await this.call(`/advertiser/info/?advertiser_ids=${ids}`, { get: true });
      return { ok: true, message: `advertiser ${this.c.advertiserId}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async send(events: AdConversion[]): Promise<ConversionSendResult> {
    const result = emptyResult();
    if (!this.c.pixelId || !this.c.accessToken) {
      for (const e of events) result.skipped.set(e.eventId, 'pixelId/accessToken missing');
      return result;
    }
    const ready: Record<string, unknown>[] = [];
    for (const e of events) {
      const ev = tiktokEvent(e);
      if (ev) ready.push(ev);
      else result.skipped.set(e.eventId, 'no user identifiers');
    }
    for (let i = 0; i < ready.length; i += EVENTS_BATCH) {
      const batch = ready.slice(i, i + EVENTS_BATCH);
      try {
        await this.json('/event/track/', {
          event_source: 'web',
          event_source_id: this.c.pixelId,
          ...(this.c.testEventCode ? { test_event_code: this.c.testEventCode } : {}),
          data: batch,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        for (const ev of batch) result.failed.set(String(ev.event_id), reason);
      }
    }
    return result;
  }

  /** Uploads one file of hashes (one per line) and returns its `file_path`. */
  private async upload(hashes: string[]): Promise<string> {
    if (!this.c.advertiserId) throw new AdPlatformError('advertiserId is required for audiences');
    const file = Buffer.from(`${hashes.join('\n')}\n`, 'utf8');
    const boundary = `forest${Date.now().toString(16)}`;
    const part = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const body = Buffer.concat([
      Buffer.from(
        part('advertiser_id', this.c.advertiserId) +
          part('calculate_type', CALCULATE_TYPE) +
          part('file_signature', createHash('md5').update(file).digest('hex')) +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="forest.txt"\r\n` +
          'Content-Type: text/plain\r\n\r\n',
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const data = await this.call('/dmp/custom_audience/file/upload/', {
      body: new Uint8Array(body),
      type: `multipart/form-data; boundary=${boundary}`,
    });
    const path = typeof data.file_path === 'string' ? data.file_path : null;
    if (!path) throw new AdPlatformError('file/upload: no file_path');
    return path;
  }

  /** The audience is created from its first file in one call (nothing to lose in between). */
  async create(name: string, hashes: string[]): Promise<AudienceCreated> {
    const filePath = await this.upload(hashes);
    const data = await this.json('/dmp/custom_audience/create/', {
      advertiser_id: this.c.advertiserId,
      custom_audience_name: name.slice(0, 128),
      calculate_type: CALCULATE_TYPE,
      file_paths: [filePath],
    });
    const id = data.custom_audience_id;
    if (typeof id !== 'string' && typeof id !== 'number')
      throw new AdPlatformError('custom_audience/create: no id');
    return { id: String(id), seeded: true };
  }

  private async update(id: string, action: 'APPEND' | 'REMOVE', hashes: string[]) {
    if (!hashes.length) return;
    const filePath = await this.upload(hashes);
    await this.json('/dmp/custom_audience/update/', {
      advertiser_id: this.c.advertiserId,
      custom_audience_id: id,
      action,
      file_paths: [filePath],
    });
  }

  add(id: string, hashes: string[]): Promise<void> {
    return this.update(id, 'APPEND', hashes);
  }

  remove(id: string, hashes: string[]): Promise<void> {
    return this.update(id, 'REMOVE', hashes);
  }
}
