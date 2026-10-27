'use client';

import { cn } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { clientApi } from '@/lib/client-api';
import { resetFavourites } from '@/lib/favourites';
import { useHydrated } from '@/lib/use-hydrated';

export const accountTabs = [
  { key: 'orders', href: routes.account },
  { key: 'addresses', href: `${routes.account}/manzillar` },
  { key: 'favorites', href: `${routes.account}/sevimlilar` },
  { key: 'notifications', href: `${routes.account}/bildirishnomalar` },
  { key: 'settings', href: `${routes.account}/sozlamalar` },
] as const;

/** Cabinet menu (design: Kabinet sidebar). Horizontal scroller on mobile. */
export function AccountNav({ counts }: { counts: Partial<Record<string, number>> }) {
  const t = useTranslations('account');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('menu')}
      className="-mx-3 overflow-x-auto px-3 lg:mx-0 lg:overflow-visible lg:rounded-[32px] lg:bg-panel lg:p-3 lg:px-3"
    >
      <ul className="flex gap-2 lg:flex-col lg:gap-1">
        {accountTabs.map((tab) => {
          const active = pathname === tab.href;
          const count = counts[tab.key];
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-3 rounded-pill px-[18px] py-3 text-[15px] font-medium transition-colors lg:rounded-[20px] lg:py-3.5',
                  active ? 'bg-ink text-white' : 'bg-panel hover:bg-canvas lg:bg-transparent',
                )}
              >
                {t(`tabs.${tab.key}`)}
                {count ? (
                  <span className={cn('text-[13px]', active ? 'text-on-dark-muted' : 'text-muted')}>
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0">
          <LogoutButton />
        </li>
      </ul>
    </nav>
  );
}

export function LogoutButton() {
  const t = useTranslations('account');
  const router = useRouter();
  const { refresh } = useCart();
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  return (
    <button
      type="button"
      disabled={busy || !hydrated}
      data-testid="logout"
      onClick={async () => {
        setBusy(true);
        try {
          await clientApi.auth.logout();
        } finally {
          resetFavourites();
          await refresh();
          router.replace(routes.home);
          router.refresh();
        }
      }}
      className="flex min-h-11 w-full items-center rounded-pill bg-panel px-[18px] py-3 text-[15px] text-muted hover:text-ink lg:rounded-[20px] lg:bg-transparent lg:py-3.5"
    >
      {t('logout')}
    </button>
  );
}
