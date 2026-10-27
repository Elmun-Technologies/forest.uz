import { Search, User } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { CartPill, CartIconLink } from './header-cart';
import { LocaleSwitch, LocaleSwitchFallback } from './locale-switch';
import { MobileMenu } from './mobile-menu';
import { NavLinks } from './nav-links';
import logo from '../../../public/brand/forest-logo-green.png';

export interface HeaderProps {
  locale: 'uz' | 'ru';
  phone: string | null;
  hours: string | null;
}

/**
 * Global header. Desktop (≥ lg): logo, nav pill, search, UZ/RU, account, cart pill.
 * Mobile: menu sheet, centred logo, search, cart icon with live count (sticky).
 */
export async function Header({ locale, phone, hours }: HeaderProps) {
  const t = await getTranslations('header');
  return (
    <header data-chrome-mobile className="sticky top-0 z-40 bg-canvas lg:static">
      {/* Desktop */}
      <div className="mx-auto hidden max-w-[1440px] items-center gap-4 px-6 py-4 lg:flex">
        <Link
          href={routes.home}
          prefetch={false}
          aria-label={t('homeLabel')}
          className="block w-[120px] shrink-0"
        >
          <Image src={logo} alt="Forest" width={120} sizes="120px" />
        </Link>
        <NavLinks className="ml-6" />
        <div className="ml-auto flex items-center gap-2">
          <form
            role="search"
            action={`/${locale}${routes.search}`}
            className="flex h-12 w-[200px] items-center gap-2 rounded-pill bg-panel px-4 focus-within:outline-3 focus-within:outline-forest xl:w-60"
          >
            <Search size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden />
            <label htmlFor="hdr-search" className="sr-only">
              {t('searchLabel')}
            </label>
            <input
              id="hdr-search"
              name="q"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder={t('searchPlaceholder')}
              className="w-full min-w-0 bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
            />
          </form>
          <Suspense fallback={<LocaleSwitchFallback locale={locale} />}>
            <LocaleSwitch locale={locale} />
          </Suspense>
          <Link
            href={routes.account}
            prefetch={false}
            aria-label={t('account')}
            title={t('account')}
            className="grid size-12 place-items-center rounded-pill bg-panel text-ink transition-colors hover:bg-sage-50"
          >
            <User size={20} strokeWidth={1.8} aria-hidden />
          </Link>
          <CartPill />
        </div>
      </div>

      {/* Mobile */}
      <div className="flex items-center gap-2 px-4 py-3 lg:hidden">
        <MobileMenu locale={locale} phone={phone} hours={hours} />
        <Link
          href={routes.home}
          prefetch={false}
          aria-label={t('homeLabel')}
          className="mx-auto block w-24"
        >
          <Image src={logo} alt="Forest" width={96} sizes="96px" />
        </Link>
        <Link
          href={routes.search}
          prefetch={false}
          aria-label={t('search')}
          className="grid size-11 place-items-center rounded-pill bg-panel text-ink"
        >
          <Search size={18} strokeWidth={2} aria-hidden />
        </Link>
        <CartIconLink />
      </div>
    </header>
  );
}
