import type { HttpClient } from '../../http-client';
import type { HealthResult } from '../types';
import {
  type AdConversion,
  AdPlatformError,
  type AudienceListProvider,
  type ConversionProvider,
  type ConversionSendResult,
  emptyResult,
  hashPhone,
  platformError,
  sha256Hex,
} from './types';

/**
 * Meta Marketing API (docs/runbooks/ads.md, sources: facebook-nodejs-business-sdk @0d245ec,
 * facebook-python-business-sdk @efd8423):
 * - Conversions API: `POST /{pixel_id}/events` `{data: [ServerEvent], test_event_code?}`;
 * - Custom Audiences: `POST /act_{ad_account_id}/customaudiences` (subtype CUSTOM,
 *   customer_file_source USER_PROVIDED_ONLY), members via `POST|DELETE /{audience_id}/users`
 *   `{payload: {schema: 'PHONE_SHA256', data: [hash]}}`.
 * The access token travels in the body (never in a logged URL). Phone = digits with country code.
 */
export const META_GRAPH_URL = 'https://graph.facebook.com/v26.0';

/** SDK limit per `/users` call. */
const USERS_BATCH = 10_000;
const EVENTS_BATCH = 1_000;

const EVENT_NAME: Record<AdConversion['name'], string> = {
  lead: 'Lead',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
};

export interface MetaCredentials {
  pixelId?: string;
  accessToken?: string;
  testEventCode?: string;
  adAccountId?: string;
}

interface Deps {
  http: HttpClient;
  baseUrl?: string;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `fb.1.<creation ms>.<fbclid>` (fbc cookie format, CAPI `user_data.fbc`). */
export function metaFbc(fbclid: string, at: Date): string {
  return `fb.1.${at.getTime()}.${fbclid}`;
}

/** One CAPI ServerEvent (field names: SDK `server-event.js`, `user-data.js`, `custom-data.js`). */
export function metaServerEvent(e: AdConversion): Record<string, unknown> | null {
  const userData: Record<string, unknown> = {};
  const ph = e.phone ? hashPhone(e.phone, 'meta') : null;
  if (ph) userData.ph = [ph];
  if (e.customerId) userData.external_id = [sha256Hex(e.customerId)];
  if (e.clickIds.fbclid) userData.fbc = metaFbc(e.clickIds.fbclid, e.clickAt ?? e.at);
  if (Object.keys(userData).length === 0) return null;
  const customData: Record<string, unknown> = { currency: 'UZS' };
  if (e.valueSoum !== null) customData.value = e.valueSoum;
  if (e.orderNumber) customData.order_id = e.orderNumber;
  return {
    event_name: EVENT_NAME[e.name],
    event_time: Math.floor(e.at.getTime() / 1000),
    event_id: e.eventId,
    action_source: 'website',
    ...(e.url ? { event_source_url: e.url } : {}),
    user_data: userData,
    custom_data: customData,
  };
}

export class MetaAdsProvider implements ConversionProvider, AudienceListProvider {
  readonly platform = 'meta' as const;
  readonly destination = 'meta' as const;
  private readonly base: string;

  constructor(
    private readonly c: MetaCredentials,
    private readonly deps: Deps,
  ) {
    this.base = (deps.baseUrl ?? META_GRAPH_URL).replace(/\/+$/, '');
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.deps.http.request({
      method,
      url: `${this.base}${path}`,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...body, access_token: this.c.accessToken }),
      timeoutMs: 15_000,
    });
    if (res.status < 200 || res.status >= 300)
      throw new AdPlatformError(platformError(res.status, res.text));
    try {
      return JSON.parse(res.text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async test(): Promise<HealthResult> {
    if (!this.c.pixelId || !this.c.accessToken)
      return { ok: false, message: 'pixelId and accessToken are required' };
    try {
      const res = await this.deps.http.request({
        method: 'GET',
        url: `${this.base}/${encodeURIComponent(this.c.pixelId)}?fields=id,name`,
        headers: { Authorization: `Bearer ${this.c.accessToken}` },
      });
      if (res.status !== 200) return { ok: false, message: platformError(res.status, res.text) };
      if (this.c.adAccountId) {
        const acc = await this.deps.http.request({
          method: 'GET',
          url: `${this.base}/act_${encodeURIComponent(this.c.adAccountId)}?fields=id`,
          headers: { Authorization: `Bearer ${this.c.accessToken}` },
        });
        if (acc.status !== 200)
          return { ok: false, message: `ad account: ${platformError(acc.status, acc.text)}` };
      }
      return { ok: true, message: `pixel ${this.c.pixelId}` };
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
      const ev = metaServerEvent(e);
      if (ev) ready.push(ev);
      else result.skipped.set(e.eventId, 'no user identifiers');
    }
    for (const batch of chunks(ready, EVENTS_BATCH)) {
      try {
        await this.call('POST', `/${encodeURIComponent(this.c.pixelId)}/events`, {
          data: batch,
          ...(this.c.testEventCode ? { test_event_code: this.c.testEventCode } : {}),
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        // CAPI accepts or rejects a request as a whole.
        for (const ev of batch) result.failed.set(String(ev.event_id), reason);
      }
    }
    return result;
  }

  async create(name: string, hashes: string[]): Promise<string> {
    if (!this.c.adAccountId) throw new AdPlatformError('adAccountId is required for audiences');
    const res = await this.call(
      'POST',
      `/act_${encodeURIComponent(this.c.adAccountId)}/customaudiences`,
      {
        name: name.slice(0, 200),
        subtype: 'CUSTOM',
        description: 'Forest · avtomatik segment',
        customer_file_source: 'USER_PROVIDED_ONLY',
      },
    );
    const id = typeof res.id === 'string' ? res.id : null;
    if (!id) throw new AdPlatformError('customaudiences: no id in response');
    await this.add(id, hashes);
    return id;
  }

  private async users(method: 'POST' | 'DELETE', audienceId: string, hashes: string[]) {
    for (const batch of chunks(hashes, USERS_BATCH))
      await this.call(method, `/${encodeURIComponent(audienceId)}/users`, {
        payload: { schema: 'PHONE_SHA256', data: batch },
      });
  }

  add(audienceId: string, hashes: string[]): Promise<void> {
    return this.users('POST', audienceId, hashes);
  }

  remove(audienceId: string, hashes: string[]): Promise<void> {
    return this.users('DELETE', audienceId, hashes);
  }
}
