import { createSign } from 'node:crypto';
import type { HttpClient } from '../http-client';
import type { HealthResult } from './types';

/**
 * Search-engine query stats for A9 (docs/10): Google Search Console (Search Analytics) and Yandex
 * Webmaster (popular queries). Sources, pinned versions and unverified points:
 * docs/runbooks/seo.md. Request builders and parsers are pure (unit-tested without the network).
 */

export interface SearchQueryStat {
  /** Calendar day `YYYY-MM-DD` the provider reports for. */
  date: string;
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface SearchQuerySource {
  readonly key: 'gsc' | 'ywm';
  test(): Promise<HealthResult>;
  /** Per-day, per-query stats for every day in [from, to] (inclusive, `YYYY-MM-DD`). */
  queries(from: string, to: string): Promise<SearchQueryStat[]>;
}

/** Fakes never invent numbers (CLAUDE.md "no sample data"): A9 shows its empty state. */
export class FakeSearchQuerySource implements SearchQuerySource {
  constructor(readonly key: 'gsc' | 'ywm') {}
  async test(): Promise<HealthResult> {
    return { ok: true, message: 'fake mode: no external call made' };
  }
  async queries(): Promise<SearchQueryStat[]> {
    return [];
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clip = (s: string) => s.trim().slice(0, 300);

// ───────────────────────── Google Search Console ─────────────────────────

export const GSC_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GSC_API_URL = 'https://searchconsole.googleapis.com';
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
/** API maximum per request (Schema$SearchAnalyticsQueryRequest.rowLimit). */
export const GSC_ROW_LIMIT = 25_000;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const v = JSON.parse(json) as Partial<ServiceAccount>;
    return typeof v.client_email === 'string' && typeof v.private_key === 'string'
      ? { client_email: v.client_email, private_key: v.private_key, token_uri: v.token_uri }
      : null;
  } catch {
    return null;
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** RS256 JWT assertion for the OAuth2 jwt-bearer grant (same claims as googleapis/node-gtoken). */
export function serviceAccountAssertion(sa: ServiceAccount, nowS: number, scope = GSC_SCOPE) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: GSC_TOKEN_URL,
      iat: nowS,
      exp: nowS + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(sa.private_key);
  return `${header}.${payload}.${b64url(signature)}`;
}

export function gscQueryBody(from: string, to: string, startRow: number) {
  return {
    startDate: from,
    endDate: to,
    dimensions: ['date', 'query'],
    type: 'web',
    rowLimit: GSC_ROW_LIMIT,
    startRow,
  };
}

export function parseGscRows(body: unknown): SearchQueryStat[] {
  const rows = (body as { rows?: unknown[] } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  const out: SearchQueryStat[] = [];
  for (const r of rows as {
    keys?: unknown[];
    clicks?: unknown;
    impressions?: unknown;
    position?: unknown;
  }[]) {
    const [date, query] = Array.isArray(r.keys) ? r.keys : [];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof query !== 'string')
      continue;
    out.push({
      date,
      query: clip(query),
      clicks: Math.round(num(r.clicks)),
      impressions: Math.round(num(r.impressions)),
      position: typeof r.position === 'number' ? r.position : null,
    });
  }
  return out;
}

export class GoogleSearchConsoleSource implements SearchQuerySource {
  readonly key = 'gsc' as const;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly creds: { serviceAccountJson?: string; siteUrl?: string },
    private readonly http: HttpClient,
    private readonly now: () => number = Date.now,
  ) {}

  private get siteUrl(): string {
    const site = this.creds.siteUrl?.trim();
    if (!site) throw new Error('siteUrl is required (https://forest.uz/ or sc-domain:forest.uz)');
    return site;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const sa = parseServiceAccount(this.creds.serviceAccountJson ?? '');
    if (!sa) throw new Error('service account JSON must contain client_email and private_key');
    const res = await this.http.request({
      method: 'POST',
      url: GSC_TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(sa, Math.floor(this.now() / 1000)),
      }).toString(),
      idempotent: true,
    });
    const body = JSON.parse(res.text || '{}') as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (res.status !== 200 || !body.access_token)
      throw new Error(`token: HTTP ${res.status} ${body.error ?? ''}`.trim());
    this.token = {
      value: body.access_token,
      until: this.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000,
    };
    return body.access_token;
  }

  async test(): Promise<HealthResult> {
    try {
      const today = new Date(this.now()).toISOString().slice(0, 10);
      await this.page(today, today, 0);
      return { ok: true, message: `Search Console: ${this.siteUrl}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private async page(from: string, to: string, startRow: number): Promise<SearchQueryStat[]> {
    const url = `${GSC_API_URL}/webmasters/v3/sites/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`;
    const res = await this.http.request({
      method: 'POST',
      url,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gscQueryBody(from, to, startRow)),
      // A read: safe to retry.
      idempotent: true,
      timeoutMs: 30_000,
    });
    if (res.status !== 200) throw new Error(`searchAnalytics: HTTP ${res.status}`);
    return parseGscRows(JSON.parse(res.text || '{}'));
  }

  async queries(from: string, to: string): Promise<SearchQueryStat[]> {
    const out: SearchQueryStat[] = [];
    for (let start = 0; start < 10 * GSC_ROW_LIMIT; start += GSC_ROW_LIMIT) {
      const rows = await this.page(from, to, start);
      out.push(...rows);
      if (rows.length < GSC_ROW_LIMIT) break;
    }
    return out;
  }
}

// ───────────────────────── Yandex Webmaster ─────────────────────────

export const YWM_API_URL = 'https://api.webmaster.yandex.net/v4';
/** Documented maximum `limit` of search-queries/popular. */
export const YWM_LIMIT = 500;
const YWM_INDICATORS = ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'] as const;

/** Query string for one calendar day (`date_from`/`date_to` are ISO instants; day = UTC bounds). */
export function ywmPopularQuery(day: string, offset: number): string {
  const p = new URLSearchParams({
    order_by: 'TOTAL_SHOWS',
    date_from: `${day}T00:00:00.000Z`,
    date_to: `${day}T23:59:59.999Z`,
    limit: String(YWM_LIMIT),
    offset: String(offset),
  });
  for (const i of YWM_INDICATORS) p.append('query_indicator', i);
  return p.toString();
}

export function parseYwmPopular(day: string, body: unknown): SearchQueryStat[] {
  const queries = (body as { queries?: unknown[] } | null)?.queries;
  if (!Array.isArray(queries)) return [];
  const out: SearchQueryStat[] = [];
  for (const q of queries as { query_text?: unknown; indicators?: Record<string, unknown> }[]) {
    if (typeof q.query_text !== 'string' || !q.query_text.trim()) continue;
    const ind = q.indicators ?? {};
    out.push({
      date: day,
      query: clip(q.query_text),
      clicks: Math.round(num(ind.TOTAL_CLICKS)),
      impressions: Math.round(num(ind.TOTAL_SHOWS)),
      position: typeof ind.AVG_SHOW_POSITION === 'number' ? ind.AVG_SHOW_POSITION : null,
    });
  }
  return out;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}

export class YandexWebmasterSource implements SearchQuerySource {
  readonly key = 'ywm' as const;
  private userId: string | null;

  constructor(
    private readonly creds: { oauthToken?: string; userId?: string; hostId?: string },
    private readonly http: HttpClient,
    private readonly baseUrl = YWM_API_URL,
  ) {
    this.userId = creds.userId?.trim() || null;
  }

  private async get(path: string): Promise<unknown> {
    if (!this.creds.oauthToken) throw new Error('oauthToken is required');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.baseUrl}${path}`,
      headers: { Authorization: `OAuth ${this.creds.oauthToken}` },
      timeoutMs: 20_000,
    });
    if (res.status !== 200)
      throw new Error(`Yandex Webmaster ${path.split('?')[0]}: HTTP ${res.status}`);
    return JSON.parse(res.text || '{}');
  }

  private async user(): Promise<string> {
    if (this.userId) return this.userId;
    const body = (await this.get('/user')) as { user_id?: unknown };
    if (body.user_id === undefined || body.user_id === null) throw new Error('no user_id');
    this.userId = String(body.user_id);
    return this.userId;
  }

  private host(): string {
    const host = this.creds.hostId?.trim();
    if (!host) throw new Error('hostId is required (e.g. https:forest.uz:443)');
    return encodeURIComponent(host);
  }

  async test(): Promise<HealthResult> {
    try {
      const user = await this.user();
      await this.get(`/user/${user}/hosts/${this.host()}`);
      return { ok: true, message: `Yandex Webmaster: ${this.creds.hostId}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async queries(from: string, to: string): Promise<SearchQueryStat[]> {
    const user = await this.user();
    const out: SearchQueryStat[] = [];
    for (const day of daysBetween(from, to)) {
      for (let offset = 0; offset < 10 * YWM_LIMIT; offset += YWM_LIMIT) {
        const body = await this.get(
          `/user/${user}/hosts/${this.host()}/search-queries/popular?${ywmPopularQuery(day, offset)}`,
        );
        const rows = parseYwmPopular(day, body);
        out.push(...rows);
        if (rows.length < YWM_LIMIT) break;
      }
    }
    return out;
  }
}
