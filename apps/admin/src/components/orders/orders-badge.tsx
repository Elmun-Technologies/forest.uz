'use client';

import type { AdminOrderBadgeDto } from '@forest/contracts/core';
import { useEffect, useState } from 'react';
import { adminFetch } from '../../lib/client-api';

/** Sidebar count of orders needing action (COD to confirm + to pack/ship), polled every 60 s. */
export function OrdersBadge({ active }: { active: boolean }) {
  const [badge, setBadge] = useState<AdminOrderBadgeDto | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      adminFetch<AdminOrderBadgeDto>('/admin/orders/badge')
        .then((b) => alive && setBadge(b))
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
  if (!badge || badge.count === 0) return null;
  return (
    <span
      data-testid="orders-badge"
      title={badge.slaRisk ? `${badge.slaRisk} ta SLA xavfi` : undefined}
      className={
        active
          ? 'rounded-pill bg-sage px-2 py-0.5 text-[11px] font-bold text-ink'
          : badge.slaRisk
            ? 'rounded-pill bg-critical-bg px-2 py-0.5 text-[11px] font-bold text-critical'
            : 'rounded-pill bg-sage px-2 py-0.5 text-[11px] font-bold text-ink'
      }
    >
      {badge.count}
      <span className="sr-only"> ta buyurtma kutmoqda</span>
    </span>
  );
}
