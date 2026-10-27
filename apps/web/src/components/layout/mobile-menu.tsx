'use client';

import { Menu } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MenuProps } from './mobile-menu-dialog';

const MobileMenuDialog = dynamic(() => import('./mobile-menu-dialog'), { ssr: false });

/** Menu button; the drawer code (Radix Dialog) is fetched only when the menu is opened. */
export function MobileMenu(props: MenuProps) {
  const t = useTranslations('header');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t('menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-pill bg-panel text-ink"
      >
        <Menu size={20} strokeWidth={2} aria-hidden />
      </button>
      {open ? <MobileMenuDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
