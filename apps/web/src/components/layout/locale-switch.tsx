'use client';

import { cn } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';

const LOCALES = [
  { code: 'uz', label: 'UZ', name: "O'zbekcha" },
  { code: 'ru', label: 'RU', name: 'Русский' },
] as const;

function Switch({ locale, href, className }: { locale: string; href: string; className?: string }) {
  const t = useTranslations('header');
  return (
    <nav
      aria-label={t('language')}
      className={cn('flex h-12 items-center rounded-pill bg-panel p-1', className)}
    >
      {LOCALES.map((l) => (
        <Link
          key={l.code}
          href={href}
          locale={l.code}
          prefetch={false}
          hrefLang={l.code}
          lang={l.code}
          aria-label={l.name}
          aria-current={l.code === locale ? 'true' : undefined}
          className={cn(
            'rounded-pill px-3 py-2 text-[13px] font-semibold transition-colors',
            l.code === locale ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** UZ/RU switch that keeps the current path and query (`/uz/katalog?color=…` ↔ `/ru/…`). */
export function LocaleSwitch({ locale, className }: { locale: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <Switch
      locale={locale}
      href={search ? `${pathname}?${search}` : pathname}
      className={className}
    />
  );
}

/** Suspense fallback (static render): same links without the query string. */
export function LocaleSwitchFallback({
  locale,
  className,
}: {
  locale: string;
  className?: string;
}) {
  const pathname = usePathname();
  return <Switch locale={locale} href={pathname} className={className} />;
}
