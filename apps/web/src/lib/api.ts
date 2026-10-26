import 'server-only';
import type { ApiErrorBody, Locale } from '@forest/contracts';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.error.message ?? `API ${status}`);
  }
}

/** Server-side API call (RSC / route handlers). Revalidates every 30 s by default (ISR). */
export async function apiGet<T>(
  path: string,
  locale: Locale,
  init: { revalidate?: number | false; tags?: string[] } = {},
): Promise<T> {
  const res = await fetch(`${API}/v1${path}`, {
    headers: { 'Accept-Language': locale },
    next: { revalidate: init.revalidate ?? 30, tags: init.tags },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
