'use client';

import type { ProductCardDto } from '@forest/contracts';
import { cn } from '@forest/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { clientApi } from '@/lib/client-api';
import { ProductCard } from '@/components/product/product-card';

/**
 * Grid + crawlable pagination. Page links are real `?page=n` URLs (SEO, no-JS); "Yana ko'rsatish"
 * progressively enhances to append the next page in place.
 */
export function ProductGrid({
  children,
  page,
  pages,
  pageHref,
  apiQuery,
  className,
}: {
  children: ReactNode;
  page: number;
  pages: number;
  /** Locale-less href for page n (keeps current filters). */
  pageHref: Record<number, string>;
  /** `/catalog/products` query without `page` (filters, category, limit). */
  apiQuery: string;
  className?: string;
}) {
  const t = useTranslations('catalog');
  const locale = useLocale() as 'uz' | 'ru';
  const [extra, setExtra] = useState<ProductCardDto[]>([]);
  const [loaded, setLoaded] = useState(page);
  const [busy, setBusy] = useState(false);

  async function more(e: React.MouseEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const next = loaded + 1;
      const res = await clientApi.catalog.products(`${apiQuery}&page=${next}`);
      setExtra((x) => [...x, ...res.items]);
      setLoaded(next);
    } catch {
      window.location.href = `/${locale}${pageHref[loaded + 1] ?? ''}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul
        className={cn(
          'grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] lg:gap-4',
          className,
        )}
      >
        {children}
        {extra.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} locale={locale} list="catalog" />
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav
          aria-label={t('pagination')}
          className="flex flex-wrap items-center justify-center gap-2 pt-4"
        >
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => {
            const current = n >= page && n <= loaded;
            return (
              <Link
                key={n}
                href={pageHref[n] ?? '#'}
                aria-label={t('page', { page: n })}
                aria-current={n === page ? 'page' : undefined}
                scroll={false}
                className={cn(
                  'tabular grid size-12 place-items-center rounded-pill font-semibold transition-colors',
                  current ? 'bg-ink text-white' : 'bg-panel hover:bg-sage-50',
                )}
              >
                {n}
              </Link>
            );
          })}
          {loaded < pages ? (
            <Link
              href={pageHref[loaded + 1] ?? '#'}
              onClick={more}
              aria-busy={busy || undefined}
              data-testid="load-more"
              className="inline-flex h-12 items-center rounded-pill border-[1.5px] border-ink px-[22px] text-sm font-medium hover:bg-ink hover:text-white"
            >
              {busy ? t('loading') : t('loadMore')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
