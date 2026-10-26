import 'server-only';
import type { ApiErrorBody, Locale } from '@forest/contracts';
import { headers } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.error.message ?? `API ${status}`);
  }
}

export interface ApiGetOptions {
  /** ISR seconds for shared (non-personal) data. Ignored when `personal` is set. */
  revalidate?: number | false;
  tags?: string[];
  /**
   * The response depends on the visitor (cart, session, prices for a logged-in customer…):
   * forwards the incoming Cookie header and disables the data cache. Makes the route dynamic.
   */
  personal?: boolean;
}

/** Server-side API call (RSC / route handlers). Revalidates every 30 s by default (ISR). */
export async function apiGet<T>(
  path: string,
  locale: Locale,
  init: ApiGetOptions = {},
): Promise<T> {
  const requestHeaders: Record<string, string> = { 'Accept-Language': locale };
  let cacheInit: RequestInit;
  if (init.personal) {
    const cookie = (await headers()).get('cookie');
    if (cookie) requestHeaders.cookie = cookie;
    cacheInit = { cache: 'no-store' };
  } else {
    cacheInit = { next: { revalidate: init.revalidate ?? 30, tags: init.tags } };
  }
  const res = await fetch(`${API}/v1${path}`, { headers: requestHeaders, ...cacheInit });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/**
 * Like `apiGet`, but resolves to `null` when the endpoint fails or doesn't exist yet, so optional
 * page blocks can be hidden instead of breaking the page. Never use it for the page's main data.
 */
export async function apiGetOptional<T>(
  path: string,
  locale: Locale,
  init: ApiGetOptions = {},
): Promise<T | null> {
  try {
    return await apiGet<T>(path, locale, init);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) {
      console.error(`[api] optional ${path} failed:`, e instanceof Error ? e.message : e);
    }
    return null;
  }
}

/** Builds `?a=1&b=x,y` from a flat record, skipping empty values. */
export function toQuery(params: Record<string, string | number | boolean | string[] | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
