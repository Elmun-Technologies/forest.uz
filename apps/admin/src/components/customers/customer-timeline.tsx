'use client';

import type { CustomerTimelineItemDto } from '@forest/contracts/core';
import { Badge, cn } from '@forest/ui';
import { useState } from 'react';
import { formatWhen } from '../../lib/format';
import { timelineText } from './copy';

const TABS = [
  { key: 'all', label: 'Hammasi' },
  { key: 'orders', label: 'Xaridlar' },
  { key: 'contact', label: 'Muloqot' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function inTab(e: CustomerTimelineItemDto, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'orders')
    return e.kind === 'order_created' || e.kind === 'order_event' || e.kind === 'review';
  return e.kind === 'message' || e.kind === 'consent' || e.kind === 'note' || e.kind === 'lead';
}

/**
 * A5 "Mijoz yo'li" (basic): orders and their events, messages, consents, reviews, notes.
 * Visits/ads clicks come with first-party analytics (Phase 4) — not shown, never faked.
 */
export function CustomerTimeline({ items }: { items: CustomerTimelineItemDto[] }) {
  const [tab, setTab] = useState<Tab>('all');
  const shown = items.filter((e) => inTab(e, tab));
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Voqealar turi"
        className="flex w-fit gap-1 rounded-pill bg-canvas p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-pill px-3.5 py-1.5 text-xs font-semibold',
              tab === t.key ? 'bg-ink text-white' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-muted">Voqealar yo&apos;q.</p>
      ) : null}
      <ol className="flex flex-col" data-testid="customer-timeline">
        {shown.map((e, i) => {
          const text = timelineText(e);
          return (
            <li
              key={`${e.kind}-${e.at}-${i}`}
              className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5"
            >
              <time dateTime={e.at} className="text-xs text-muted">
                {formatWhen(e.at)}
              </time>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-semibold">{text.title}</b>
                  <Badge tone={text.chip.tone} className="h-5 text-[11px]">
                    {text.chip.label}
                  </Badge>
                </span>
                {text.detail ? <span className="text-muted">{text.detail}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
