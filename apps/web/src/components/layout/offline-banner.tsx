'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * "Internet uzildi" notice (Holatlar · 6). The cart lives on the server, so nothing is lost; the
 * banner only explains why actions fail and disappears when the connection is back.
 */
export function OfflineBanner() {
  const t = useTranslations('common');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4"
    >
      {offline ? (
        <p className="pointer-events-auto flex max-w-[560px] items-center gap-2.5 rounded-sm bg-warn-bg px-4 py-3.5 text-[13px] font-semibold text-warn shadow-float">
          <TriangleAlert size={18} aria-hidden className="shrink-0" />
          {t('offline')}
        </p>
      ) : null}
    </div>
  );
}
