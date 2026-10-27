import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False during SSR and hydration, true once React owns the DOM. Action buttons on server-rendered
 * forms stay disabled until then, so an early tap is never swallowed by a not-yet-hydrated page.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
