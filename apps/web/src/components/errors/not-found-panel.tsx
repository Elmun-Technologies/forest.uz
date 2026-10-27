import { Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';

/** 404 card (design: Holatlar · 4): search, home and catalog — never a dead end. */
export async function NotFoundPanel() {
  const [t, locale] = await Promise.all([getTranslations('errors'), getLocale()]);
  return (
    <div className="mx-auto max-w-[1440px] px-3 py-6 lg:px-6 lg:py-10">
      <section
        data-testid="not-found"
        className="mx-auto flex max-w-[560px] flex-col gap-[18px] rounded-[36px] bg-ink p-8 text-white"
      >
        <span className="self-start rounded-pill bg-dark-3 px-3 py-1.5 text-xs font-bold text-sage">
          {t('notFoundCode')}
        </span>
        <p
          aria-hidden
          className="text-[96px] leading-[0.9] font-medium tracking-[-0.06em] text-sage lg:text-[120px]"
        >
          404
        </p>
        <h1 className="text-[28px] leading-tight font-medium tracking-[-0.03em]">
          {t('notFound')}
        </h1>
        <form
          role="search"
          action={`/${locale}${routes.search}`}
          className="flex h-[52px] items-center gap-2.5 rounded-pill bg-dark-2 px-[18px] focus-within:outline-3 focus-within:outline-sage"
        >
          <Search size={18} className="text-on-dark-subtle" aria-hidden />
          <label htmlFor="nf-search" className="sr-only">
            {t('search')}
          </label>
          <input
            id="nf-search"
            name="q"
            type="search"
            placeholder={t('search')}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-subtle focus:outline-none"
          />
        </form>
        <div className="flex flex-wrap gap-2">
          <Link
            href={routes.home}
            className="rounded-pill bg-white px-[18px] py-3 text-sm font-semibold text-ink"
          >
            {t('home')}
          </Link>
          <Link
            href={routes.catalog}
            className="rounded-pill border border-[#3A4035] px-[18px] py-3 text-sm font-semibold"
          >
            {t('catalog')}
          </Link>
        </div>
      </section>
    </div>
  );
}
