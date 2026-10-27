import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Admin CSRF (docs/14): double-submit token. The readable `fr_admin_csrf` cookie is echoed by the
 * admin UI in `X-CSRF-Token`; a cross-site page can trigger a request but can neither read the
 * cookie nor set the header. With a session, the token must also be the one bound to it.
 */
export const CSRF_COOKIE = 'fr_admin_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN = /^[\w-]{32,64}$/;

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export function isCsrfToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type CsrfVerdict = 'ok' | 'missing' | 'mismatch' | 'bad_origin';

/**
 * Checks a state-changing request. `bound` = token stored in the session (null before login).
 * `origin`: when the browser sends one it must be the admin origin.
 */
export function checkCsrf(input: {
  method: string;
  header: unknown;
  cookie: unknown;
  bound: string | null;
  origin: string | undefined;
  adminOrigin: string;
}): CsrfVerdict {
  if (isSafeMethod(input.method)) return 'ok';
  if (input.origin && input.origin !== input.adminOrigin) return 'bad_origin';
  if (!isCsrfToken(input.header) || !isCsrfToken(input.cookie)) return 'missing';
  if (!same(input.header, input.cookie)) return 'mismatch';
  if (input.bound !== null && !same(input.header, input.bound)) return 'mismatch';
  return 'ok';
}
