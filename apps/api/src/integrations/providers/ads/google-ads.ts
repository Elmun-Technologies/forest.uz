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
} from './types';

/**
 * Google Ads API over REST (docs/runbooks/ads.md; sources: googleapis/googleapis @933dd1b
 * `google/ads/googleads/v26/services/*.proto` http rules, googleads/google-ads-python @2b71584
 * examples `add_customer_match_user_list.py`, `upload_enhanced_conversions_for_leads.py`):
 * - OAuth: refresh token → access token at `oauth2.googleapis.com/token`;
 * - conversions: `POST /v26/customers/{id}:uploadClickConversions` (gclid and/or hashed phone,
 *   `partialFailure: true`);
 * - Customer Match: `userLists:mutate` (crmBasedUserList CONTACT_INFO) + OfflineUserDataJob
 *   create → addOperations → run. Phone = E.164 with `+`, SHA-256 hex.
 */
export const GOOGLE_ADS_URL = 'https://googleads.googleapis.com/v26';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const OPS_BATCH = 10_000;
const CONVERSIONS_BATCH = 2_000;

export interface GoogleAdsCredentials {
  developerToken?: string;
  customerId?: string;
  loginCustomerId?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  refreshToken?: string;
  /** Purchase conversion action id. */
  conversionActionId?: string;
  leadConversionActionId?: string;
}

interface Deps {
  http: HttpClient;
  baseUrl?: string;
  tokenUrl?: string;
  now?: () => number;
}

const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '');

/** `yyyy-mm-dd hh:mm:ss+05:00` in Tashkent (the format the API requires; Uzbekistan has no DST). */
export function googleDateTime(at: Date): string {
  const t = new Date(at.getTime() + 5 * 3_600_000);
  const iso = t.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+05:00`;
}

/** One ClickConversion (REST JSON names of `ClickConversion` in conversion_upload_service.proto). */
export function googleClickConversion(
  e: AdConversion,
  customerId: string,
  actionId: string,
): Record<string, unknown> | null {
  const phone = e.phone ? hashPhone(e.phone, 'google') : null;
  if (!e.clickIds.gclid && !phone) return null;
  return {
    conversionAction: `customers/${customerId}/conversionActions/${actionId}`,
    conversionDateTime: googleDateTime(e.at),
    ...(e.clickIds.gclid ? { gclid: e.clickIds.gclid } : {}),
    ...(phone ? { userIdentifiers: [{ hashedPhoneNumber: phone }] } : {}),
    ...(e.valueSoum !== null ? { conversionValue: e.valueSoum, currencyCode: 'UZS' } : {}),
    orderId: e.orderNumber ?? e.eventId,
    consent: { adUserData: 'GRANTED' },
  };
}

export class GoogleAdsProvider implements ConversionProvider, AudienceListProvider {
  readonly platform = 'google' as const;
  readonly destination = 'google' as const;
  private readonly base: string;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly c: GoogleAdsCredentials,
    private readonly deps: Deps,
  ) {
    this.base = (deps.baseUrl ?? GOOGLE_ADS_URL).replace(/\/+$/, '');
  }

  private get cid(): string {
    return digits(this.c.customerId);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const { oauthClientId, oauthClientSecret, refreshToken } = this.c;
    if (!oauthClientId || !oauthClientSecret || !refreshToken)
      throw new AdPlatformError('OAuth client id/secret and refresh token are required');
    const res = await this.deps.http.request({
      method: 'POST',
      url: this.deps.tokenUrl ?? GOOGLE_TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
        refresh_token: refreshToken,
      }).toString(),
      idempotent: true,
    });
    if (res.status !== 200)
      throw new AdPlatformError(`oauth: ${platformError(res.status, res.text)}`);
    const body = JSON.parse(res.text) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AdPlatformError('oauth: no access_token');
    this.token = {
      value: body.access_token,
      until: this.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000,
    };
    return body.access_token;
  }

  private async call(path: string, body: unknown, method: 'GET' | 'POST' = 'POST') {
    if (!this.c.developerToken || !this.cid)
      throw new AdPlatformError('developerToken and customerId are required');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'developer-token': this.c.developerToken,
      'Content-Type': 'application/json',
    };
    const login = digits(this.c.loginCustomerId);
    if (login) headers['login-customer-id'] = login;
    const res = await this.deps.http.request({
      method,
      url: `${this.base}${path}`,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      timeoutMs: 20_000,
    });
    if (res.status < 200 || res.status >= 300)
      throw new AdPlatformError(platformError(res.status, res.text));
    return JSON.parse(res.text || '{}') as Record<string, unknown>;
  }

  async test(): Promise<HealthResult> {
    try {
      await this.call('/customers:listAccessibleCustomers', undefined, 'GET');
      return { ok: true, message: `customer ${this.cid}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private actionFor(name: AdConversion['name']): string | null {
    const id =
      name === 'purchase'
        ? digits(this.c.conversionActionId)
        : name === 'lead'
          ? digits(this.c.leadConversionActionId)
          : '';
    return id || null;
  }

  async send(events: AdConversion[]): Promise<ConversionSendResult> {
    const result = emptyResult();
    const ready: { eventId: string; body: Record<string, unknown> }[] = [];
    for (const e of events) {
      const action = this.actionFor(e.name);
      if (!action) {
        result.skipped.set(e.eventId, `no conversion action for ${e.name}`);
        continue;
      }
      const body = googleClickConversion(e, this.cid, action);
      if (body) ready.push({ eventId: e.eventId, body });
      else result.skipped.set(e.eventId, 'no gclid or phone');
    }
    for (let i = 0; i < ready.length; i += CONVERSIONS_BATCH) {
      const batch = ready.slice(i, i + CONVERSIONS_BATCH);
      try {
        const res = await this.call(`/customers/${this.cid}:uploadClickConversions`, {
          conversions: batch.map((b) => b.body),
          partialFailure: true,
        });
        // Partial failure: `partialFailureError.details[].errors[].location.fieldPathElements`
        // name the index of the failed conversion.
        for (const index of failedIndexes(res.partialFailureError)) {
          const item = batch[index];
          if (item) result.failed.set(item.eventId, 'rejected by Google Ads (partial failure)');
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        for (const b of batch) result.failed.set(b.eventId, reason);
      }
    }
    return result;
  }

  async create(name: string, hashes: string[]): Promise<string> {
    const res = await this.call(`/customers/${this.cid}/userLists:mutate`, {
      operations: [
        {
          create: {
            name: name.slice(0, 200),
            description: 'Forest · avtomatik segment',
            membershipLifeSpan: 540,
            crmBasedUserList: { uploadKeyType: 'CONTACT_INFO' },
          },
        },
      ],
    });
    const results = res.results as { resourceName?: string }[] | undefined;
    const id = results?.[0]?.resourceName;
    if (!id) throw new AdPlatformError('userLists:mutate: no resourceName');
    await this.add(id, hashes);
    return id;
  }

  /** One OfflineUserDataJob per call: create → addOperations (≤ 10 000 each) → run. */
  private async job(userList: string, op: 'create' | 'remove', hashes: string[]) {
    if (!hashes.length) return;
    const job = await this.call(`/customers/${this.cid}/offlineUserDataJobs:create`, {
      job: {
        type: 'CUSTOMER_MATCH_USER_LIST',
        customerMatchUserListMetadata: {
          userList,
          consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' },
        },
      },
    });
    const resource = typeof job.resourceName === 'string' ? job.resourceName : null;
    if (!resource) throw new AdPlatformError('offlineUserDataJobs:create: no resourceName');
    for (let i = 0; i < hashes.length; i += OPS_BATCH) {
      await this.call(`/${resource}:addOperations`, {
        enablePartialFailure: true,
        operations: hashes
          .slice(i, i + OPS_BATCH)
          .map((h) => ({ [op]: { userIdentifiers: [{ hashedPhoneNumber: h }] } })),
      });
    }
    await this.call(`/${resource}:run`, {});
  }

  add(userList: string, hashes: string[]): Promise<void> {
    return this.job(userList, 'create', hashes);
  }

  remove(userList: string, hashes: string[]): Promise<void> {
    return this.job(userList, 'remove', hashes);
  }
}

/** Indexes of failed operations in a Google Ads partial-failure status (REST JSON). */
export function failedIndexes(partialFailureError: unknown): number[] {
  const out = new Set<number>();
  const details = (partialFailureError as { details?: unknown[] } | undefined)?.details ?? [];
  for (const d of details) {
    const errors = (d as { errors?: unknown[] }).errors ?? [];
    for (const err of errors) {
      const path =
        (err as { location?: { fieldPathElements?: { fieldName?: string; index?: number }[] } })
          .location?.fieldPathElements ?? [];
      const first = path.find((p) => p.fieldName === 'conversions' || p.fieldName === 'operations');
      if (typeof first?.index === 'number') out.add(first.index);
    }
  }
  return [...out];
}
