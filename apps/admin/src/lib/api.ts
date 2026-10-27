import 'server-only';
import type { AdminMeDto, ApiErrorBody } from '@forest/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.error.message ?? `API ${status}`);
  }
}

/**
 * Server-side admin API call (RSC). Forwards the browser's cookies (`fr_admin`); never cached —
 * every admin response is personal.
 */
export async function adminGet<T>(path: string): Promise<T> {
  const jar = await cookies();
  const res = await fetch(`${API}/v1${path}`, {
    headers: { cookie: jar.toString(), 'Accept-Language': 'uz' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new AdminApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/** The signed-in staff member, or null (no/expired session). One API call per request. */
export const getMe = cache(async (): Promise<AdminMeDto | null> => {
  try {
    return await adminGet<AdminMeDto>('/admin/auth/me');
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 401) return null;
    throw e;
  }
});

/** Where a session must go next (login, TOTP code, enrolment or the panel). */
export function stagePath(me: AdminMeDto | null): string {
  if (!me) return '/login';
  if (me.stage === 'totp') return '/login/totp';
  if (me.stage === 'setup') return '/totp/setup';
  return '/';
}

/** For panel pages: a full session, else redirect to the step that's missing. */
export async function requireFullSession(): Promise<AdminMeDto> {
  const me = await getMe();
  if (!me || me.stage !== 'full') redirect(stagePath(me));
  return me;
}
