'use client';

import { cn } from '@forest/ui';
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';

/**
 * WAI-ARIA tabs (roving tabindex, arrow keys). Panels are server-rendered and stay in the DOM
 * (`hidden`), so all product copy is crawlable.
 */
export function Tabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { id: string; title: string; panel: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (active + dir + tabs.length) % tabs.length;
    if (!dir && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setActive(to);
    refs.current[to]?.focus();
  };
  return (
    <div className="flex flex-col gap-7">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${tab.id}-tab`}
            aria-selected={i === active}
            aria-controls={`${base}-${tab.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKey}
            className={cn(
              'rounded-pill px-5 py-[11px] text-sm font-medium transition-colors',
              i === active ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage',
            )}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          hidden={i !== active}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
