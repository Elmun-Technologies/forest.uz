import type { HttpClient } from '../http-client';
import type { HealthResult } from './types';

/**
 * IndexNow (Yandex, Bing) and PageSpeed Insights (lab CWV) for A9. Sources and unverified points:
 * docs/runbooks/seo.md. Builders/parsers are pure.
 */

// ───────────────────────── IndexNow ─────────────────────────

export const INDEXNOW_ENDPOINTS = [
  'https://yandex.com/indexnow',
  'https://www.bing.com/indexnow',
] as const;
/** Protocol maximum URLs per POST. */
export const INDEXNOW_MAX_URLS = 10_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** One POST body per ≤ 10 000 URLs of our host (others are dropped: engines answer 422). */
export function indexNowPayloads(siteUrl: string, key: string, urls: string[]): IndexNowPayload[] {
  const site = new URL(siteUrl);
  const own = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === site.host;
    } catch {
      return false;
    }
  });
  const out: IndexNowPayload[] = [];
  for (let i = 0; i < own.length; i += INDEXNOW_MAX_URLS)
    out.push({
      host: site.host,
      key,
      keyLocation: `${site.origin}/${key}.txt`,
      urlList: own.slice(i, i + INDEXNOW_MAX_URLS),
    });
  return out;
}

/** Engines only accept a public host the key file can be fetched from. */
export function isPublicSite(siteUrl: string): boolean {
  try {
    const u = new URL(siteUrl);
    return (
      u.protocol === 'https:' &&
      !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) &&
      u.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/** 200 = accepted, 202 = accepted while the key is being validated; anything else is a failure. */
export function indexNowOutcome(status: number): { ok: boolean; message: string } {
  const known: Record<number, string> = {
    200: 'OK',
    202: 'accepted (key validation pending)',
    400: 'bad request',
    403: 'key not valid (key file missing or wrong)',
    422: 'URLs do not belong to the host or key mismatch',
    429: 'too many requests',
  };
  return {
    ok: status === 200 || status === 202,
    message: `HTTP ${status} ${known[status] ?? ''}`.trim(),
  };
}

export async function submitIndexNow(
  http: HttpClient,
  payload: IndexNowPayload,
): Promise<{ endpoint: string; ok: boolean; message: string }[]> {
  const results = [];
  for (const endpoint of INDEXNOW_ENDPOINTS) {
    try {
      const res = await http.request({
        method: 'POST',
        url: endpoint,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        // Re-submitting the same URLs is harmless.
        idempotent: true,
      });
      results.push({ endpoint, ...indexNowOutcome(res.status) });
    } catch (e) {
      results.push({ endpoint, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// ───────────────────────── PageSpeed Insights ─────────────────────────

export const PAGESPEED_URL =
  'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface PageSpeedLab {
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
}

export interface PageSpeedSource {
  test(): Promise<HealthResult>;
  run(url: string, strategy: 'mobile' | 'desktop'): Promise<PageSpeedLab>;
}

export function pageSpeedQuery(url: string, strategy: string, apiKey?: string): string {
  const p = new URLSearchParams({ url, strategy, category: 'performance' });
  if (apiKey) p.set('key', apiKey);
  return p.toString();
}

/** Lighthouse lab values from a runPagespeed v5 response. */
export function parsePageSpeed(body: unknown): PageSpeedLab {
  const lr = (body as { lighthouseResult?: Record<string, unknown> } | null)?.lighthouseResult;
  const audits = (lr?.audits ?? {}) as Record<string, { numericValue?: unknown }>;
  const perf = (lr?.categories as Record<string, { score?: unknown }> | undefined)?.performance;
  const value = (id: string) => {
    const v = audits[id]?.numericValue;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const ms = (id: string) => {
    const v = value(id);
    return v === null ? null : Math.round(v);
  };
  const cls = value('cumulative-layout-shift');
  return {
    score: typeof perf?.score === 'number' ? Math.round(perf.score * 100) : null,
    lcpMs: ms('largest-contentful-paint'),
    cls: cls === null ? null : Math.round(cls * 1000) / 1000,
    tbtMs: ms('total-blocking-time'),
    fcpMs: ms('first-contentful-paint'),
  };
}

export class PageSpeedInsights implements PageSpeedSource {
  constructor(
    private readonly creds: { apiKey?: string },
    private readonly http: HttpClient,
  ) {}

  async test(): Promise<HealthResult> {
    // A real run takes 10–30 s and spends quota; the key is checked on the first A9 run.
    return { ok: true, message: this.creds.apiKey ? 'API key saved' : 'no API key: shared quota' };
  }

  async run(url: string, strategy: 'mobile' | 'desktop'): Promise<PageSpeedLab> {
    const res = await this.http.request({
      method: 'GET',
      url: `${PAGESPEED_URL}?${pageSpeedQuery(url, strategy, this.creds.apiKey)}`,
      timeoutMs: 60_000,
    });
    if (res.status !== 200) throw new Error(`PageSpeed: HTTP ${res.status}`);
    return parsePageSpeed(JSON.parse(res.text || '{}'));
  }
}
