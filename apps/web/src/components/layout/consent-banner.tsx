'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { readConsent } from '@/lib/consent';

const Panel = dynamic(() => import('./consent-banner-panel'), { ssr: false });

/** Loads the consent UI only for visitors who haven't decided yet (keeps page JS lean). */
export function ConsentBanner() {
  const [needed, setNeeded] = useState(false);
  useEffect(() => setNeeded(!readConsent()), []);
  return needed ? <Panel /> : null;
}
