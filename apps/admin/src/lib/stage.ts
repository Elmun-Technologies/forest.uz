import type { AdminMeDto } from '@forest/contracts/core';

/** Client-side twin of `stagePath` (api.ts is server-only): where to go after an auth step. */
export function nextPathFor(me: AdminMeDto): string {
  if (me.stage === 'totp') return '/login/totp';
  if (me.stage === 'setup') return '/totp/setup';
  return '/';
}
