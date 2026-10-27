'use client';

import type { ProductSort } from '@forest/contracts';
import { PRODUCT_SORTS } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { CatalogFilters } from '@/lib/catalog-params';
import { useCatalogNav } from './use-catalog-nav';

/** Native select styled as a pill: keyboard/screen-reader friendly on every device. */
export function SortSelect({ filters, compact }: { filters: CatalogFilters; compact?: boolean }) {
  const t = useTranslations('catalog');
  const { apply } = useCatalogNav(filters);
  const id = useId();
  const current = t(`sort.${filters.sort}`);
  return (
    <div
      className={cn(
        'relative inline-flex items-center rounded-pill bg-panel font-medium focus-within:outline-3 focus-within:outline-forest',
        compact ? 'h-10 px-3.5 text-[13px] font-semibold' : 'h-12 px-5 text-sm',
      )}
    >
      <label htmlFor={id} className="sr-only">
        {t('sortLabel')}
      </label>
      <span aria-hidden className="pointer-events-none inline-flex items-center gap-2.5">
        {compact ? current : t('sortValue', { value: current })}
        <ChevronDown size={14} strokeWidth={2} />
      </span>
      <select
        id={id}
        value={filters.sort}
        data-track="catalog_sort"
        onChange={(e) => apply({ sort: e.target.value as ProductSort })}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {PRODUCT_SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sort.${s}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
