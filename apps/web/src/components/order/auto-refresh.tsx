'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-renders the server page a few times while a payment webhook may still be on its way
 * (the return URL is not proof of payment; the webhook is). Stops after `max` tries.
 */
export function AutoRefresh({ everyMs = 4000, max = 15 }: { everyMs?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      if (++n > max) return window.clearInterval(id);
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs, max]);
  return null;
}
