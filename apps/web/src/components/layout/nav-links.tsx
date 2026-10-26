'use client';

import { cn } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { navCategories, pageReady, routes } from '@/config/site';

export function useNavItems() {
  const t = useTranslations('header.nav');
  return [
    { key: 'catalog', href: routes.catalog, label: t('catalog') },
    { key: 'furniture', href: routes.category(navCategories.furniture), label: t('furniture') },
    { key: 'fabric', href: routes.category(navCategories.fabric), label: t('fabric') },
    ...(pageReady.inspiration
      ? [{ key: 'inspiration', href: routes.inspiration, label: t('inspiration') }]
      : []),
    ...(pageReady.brand ? [{ key: 'brand', href: routes.brand, label: t('brand') }] : []),
  ];
}

function isActive(pathname: string, href: string): boolean {
  if (href === routes.catalog) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop nav pill; the current section is highlighted and marked aria-current. */
export function NavLinks({ className }: { className?: string }) {
  const t = useTranslations('header');
  const pathname = usePathname();
  const items = useNavItems();
  return (
    <nav aria-label={t('navLabel')} className={cn('rounded-pill bg-panel p-[5px]', className)}>
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-pill px-[18px] py-[11px] text-sm font-medium transition-colors',
                  active ? 'bg-ink text-white' : 'text-ink hover:bg-canvas',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
