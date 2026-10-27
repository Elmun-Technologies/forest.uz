'use client';

import { cn } from '@forest/ui';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Icon, ICONS } from './icon';

/**
 * Panel frame: fixed-width sidebar + fluid main from 1024 px (docs/11); below that the sidebar
 * collapses behind a menu button so critical actions stay usable on phones.
 */
export function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 lg:flex-row">
      <div className="flex items-center justify-between rounded-lg bg-ink px-4 py-3 text-white lg:hidden">
        <span className="text-lg font-semibold tracking-[-0.03em]">forest · admin</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen((v) => !v)}
          className="grid size-10 place-items-center rounded-full hover:bg-dark-2"
        >
          <Icon d={open ? ICONS.close : ICONS.menu} size={20} />
          <span className="sr-only">Menyu</span>
        </button>
      </div>
      <div
        id="admin-sidebar"
        className={cn(
          'w-full shrink-0 lg:flex lg:min-h-[calc(100dvh-2rem)] lg:w-[264px]',
          open ? 'flex' : 'hidden',
        )}
      >
        {sidebar}
      </div>
      <main className="flex min-w-0 flex-1 flex-col gap-4">{children}</main>
    </div>
  );
}
