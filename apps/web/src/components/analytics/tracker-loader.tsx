'use client';

import { useEffect } from 'react';
import { onIdle } from '@/lib/idle';

/**
 * Injects the first-party tracker (`/t.js`, docs/07) once the page is idle, so it never competes
 * with hydration or the LCP. `src` carries the content hash (`?v=`), resolved on the server.
 */
export function TrackerLoader({ src }: { src: string }) {
  useEffect(
    () =>
      onIdle(() => {
        if (document.querySelector('script[data-forest-tracker]')) return;
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.dataset.forestTracker = '';
        document.head.appendChild(s);
      }, 4000),
    [src],
  );
  return null;
}
