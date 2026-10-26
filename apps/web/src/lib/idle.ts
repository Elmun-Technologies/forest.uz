/**
 * Runs `fn` once the main thread is idle (after hydration), or after `timeout` ms at the latest.
 * Use it for non-urgent startup work such as the first localStorage read, which is a synchronous
 * round-trip to the browser and would otherwise lengthen the hydration commit. Returns a cancel.
 */
export function onIdle(fn: () => void, timeout = 2000): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  // Safari has no requestIdleCallback.
  const id = window.setTimeout(fn, 1);
  return () => window.clearTimeout(id);
}
