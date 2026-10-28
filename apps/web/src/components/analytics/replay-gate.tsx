'use client';

import type { ReplayGateConfig } from '@forest/contracts/core';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { onIdle } from '@/lib/idle';
import { runReplayGate } from '@/lib/replay-gate';

/**
 * Session replay gate (docs/07): on idle after each route change, decides whether to load the
 * rrweb recorder (`/r.js`). Renders nothing; all logic is in `lib/replay-gate.ts`.
 */
export function ReplayGate({
  config,
  version,
}: {
  config: ReplayGateConfig | null;
  version: string;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (!config?.enabled) return;
    return onIdle(() => runReplayGate(window, config, version));
  }, [config, version, pathname]);
  return null;
}
