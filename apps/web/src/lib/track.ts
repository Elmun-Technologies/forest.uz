import type { CommerceEventName, TrackPropsMap } from '@forest/contracts/core';

type Queue = { push(item: [string, unknown, number]): void };

/**
 * Commerce events (docs/07) from storefront code. Calls before `/t.js` has loaded are queued in
 * `window.__frq`; the tracker drains it and then replaces `push`. No-op on the server.
 * Never pass phone, name, address or other text the visitor typed (the API strips it anyway).
 */
export function track<N extends CommerceEventName>(name: N, props: TrackPropsMap[N]): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __frq?: Queue };
  (w.__frq ??= [] as unknown as Queue).push([name, props, Date.now()]);
}
