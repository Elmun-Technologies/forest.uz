import 'server-only';
import { hasPermission, type Permission } from '@forest/contracts/core';
import { getMe } from './api';

/**
 * Route handlers outside the `(panel)` layout: a full admin session holding `permission`, else
 * a plain 403 (the API being down counts as no session).
 */
export async function routeAllowed(permission: Permission): Promise<boolean> {
  const me = await getMe().catch(() => null);
  return !!me && me.stage === 'full' && hasPermission(me.staff.role, permission);
}

/** Storefront origin as seen from the admin server (compose: `http://web:3000`). */
export const STOREFRONT_INTERNAL = (
  process.env.WEB_INTERNAL_URL ??
  process.env.APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
