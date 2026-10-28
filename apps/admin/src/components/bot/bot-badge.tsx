'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '../../lib/client-api';

/** Sidebar count of bot conversations needing an operator (new + complaints). */
export function BotBadge({ active }: { active: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      adminFetch<{ count: number }>('/admin/bot/inbox-count')
        .then((b) => alive && setCount(b.count))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  if (count === 0) return null;
  return (
    <span
      data-testid="bot-badge"
      className={
        active
          ? 'rounded-pill bg-sage px-2 py-0.5 text-[11px] font-bold text-ink'
          : 'rounded-pill bg-dark-3 px-2 py-0.5 text-[11px] font-bold text-white'
      }
    >
      {count}
      <span className="sr-only"> ta suhbat javob kutmoqda</span>
    </span>
  );
}
