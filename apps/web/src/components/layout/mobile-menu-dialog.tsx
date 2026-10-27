'use client';

import { formatUzPhone } from '@forest/contracts/core';
import * as Dialog from '@radix-ui/react-dialog';
import { User, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { LocaleSwitch, LocaleSwitchFallback } from './locale-switch';
import { useNavItems } from './nav-links';

export interface MenuProps {
  locale: string;
  phone: string | null;
  hours: string | null;
}

/** Mobile navigation drawer (Radix Dialog: focus trap, Esc, scroll lock); loaded on first open. */
export default function MobileMenuDialog({
  locale,
  phone,
  hours,
  onClose,
}: MenuProps & { onClose: () => void }) {
  const t = useTranslations('header');
  const tc = useTranslations('common');
  const items = useNavItems();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    onClose();
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/45" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(340px,88vw)] flex-col gap-6 overflow-y-auto rounded-r-lg bg-canvas p-5 focus:outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{t('menu')}</Dialog.Title>
            <Dialog.Close
              aria-label={tc('close')}
              className="grid size-11 place-items-center rounded-pill bg-panel"
            >
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label={t('navLabel')}>
            <ul className="flex flex-col gap-1 rounded-md bg-panel p-2">
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={close}
                    className="flex min-h-12 items-center rounded-sm px-4 text-base font-medium hover:bg-canvas"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={routes.account}
                  onClick={close}
                  className="flex min-h-12 items-center gap-3 rounded-sm px-4 text-base font-medium hover:bg-canvas"
                >
                  <User size={18} aria-hidden />
                  {t('account')}
                </Link>
              </li>
            </ul>
          </nav>
          <Suspense fallback={<LocaleSwitchFallback locale={locale} className="self-start" />}>
            <LocaleSwitch locale={locale} className="self-start" />
          </Suspense>
          {phone ? (
            <div className="mt-auto flex flex-col gap-1 text-sm text-muted">
              <span className="text-overline font-semibold tracking-[0.08em] uppercase">
                {t('contacts')}
              </span>
              <a href={`tel:${phone}`} className="tabular text-lg font-semibold text-ink">
                {formatUzPhone(phone)}
              </a>
              {hours ? <span>{hours}</span> : null}
            </div>
          ) : null}
          <Dialog.Description className="sr-only">{t('navLabel')}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
