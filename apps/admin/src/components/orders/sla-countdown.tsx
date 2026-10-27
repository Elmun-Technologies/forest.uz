'use client';

import { cn } from '@forest/ui';
import { useEffect, useState } from 'react';
import { slaText } from './sla';

/**
 * Live SLA countdown. First render uses the server's clock (`serverNow`) so the HTML matches on
 * hydration; afterwards it ticks every 30 s on the browser clock, corrected by the server offset.
 */
export function SlaCountdown({
  dueAt,
  serverNow,
  className,
}: {
  dueAt: string;
  serverNow: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const offset = new Date(serverNow).getTime() - Date.now();
    const tick = () => setNow(new Date(Date.now() + offset));
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [serverNow]);
  const left = new Date(dueAt).getTime() - now.getTime();
  return (
    <span
      className={cn(
        'text-xs font-semibold',
        left < 3_600_000 ? 'text-critical' : 'text-muted',
        className,
      )}
    >
      {slaText(dueAt, now)}
    </span>
  );
}
