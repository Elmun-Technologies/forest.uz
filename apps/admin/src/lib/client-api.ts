'use client';

import type { ApiErrorBody } from '@forest/contracts/core';

/**
 * Browser → API through the admin origin's `/api` rewrite. Every state-changing call carries the
 * CSRF double-submit header (`X-CSRF-Token` = readable `fr_admin_csrf` cookie, docs/14).
 */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const FALLBACK_MESSAGE = "Nimadir xato ketdi. Bir daqiqadan keyin qayta urinib ko'ring.";

function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)fr_admin_csrf=([\w-]+)/);
  return m?.[1] ?? null;
}

async function csrfToken(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  const res = await fetch('/api/admin/auth/csrf', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  return readCsrfCookie() ?? body?.token ?? '';
}

export async function adminFetch<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** Extra request headers (e.g. `Idempotency-Key` on refunds / manual orders). */
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  if (method !== 'GET') headers['X-CSRF-Token'] = await csrfToken();
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ClientApiError(0, 'NETWORK', "Internet aloqasini tekshirib, qayta urinib ko'ring.");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const error = body?.error;
    throw new ClientApiError(
      res.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? FALLBACK_MESSAGE,
      error?.details,
    );
  }
  return body as T;
}

/**
 * POST that returns a file (CSV/JSON export): saved through a temporary object URL. Same CSRF
 * header as `adminFetch`; API errors surface as `ClientApiError`.
 */
export async function adminDownload(path: string, body: unknown, fallbackName: string) {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrfToken() },
      body: JSON.stringify(body ?? {}),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ClientApiError(0, 'NETWORK', "Internet aloqasini tekshirib, qayta urinib ko'ring.");
  }
  if (!res.ok) {
    const err = ((await res.json().catch(() => null)) as Partial<ApiErrorBody> | null)?.error;
    throw new ClientApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? FALLBACK_MESSAGE);
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function errorText(e: unknown): string {
  return e instanceof ClientApiError ? e.message : FALLBACK_MESSAGE;
}

/** Multipart upload (one `file` field) with the CSRF header; same error mapping as `adminFetch`. */
export async function adminUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken() },
      body: form,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ClientApiError(0, 'NETWORK', "Internet aloqasini tekshirib, qayta urinib ko'ring.");
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const error = body?.error;
    throw new ClientApiError(
      res.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? FALLBACK_MESSAGE,
      error?.details,
    );
  }
  return body as T;
}
