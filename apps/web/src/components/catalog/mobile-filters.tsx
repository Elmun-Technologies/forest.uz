'use client';

import type { ProductListDto } from '@forest/contracts';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import type { CatalogFilters } from '@/lib/catalog-params';
import { FilterPanel } from './filter-panel';
import { useCatalogNav } from './use-catalog-nav';

/** Mobile "Filtr" button + bottom sheet. Filters apply live; the CTA shows the live count. */
export function MobileFilters({
  filters,
  facets,
  total,
}: {
  filters: CatalogFilters;
  facets: ProductListDto['facets'];
  total: number;
}) {
  const t = useTranslations('catalog');
  const [open, setOpen] = useState(false);
  const { reset, pending } = useCatalogNav(filters);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('filter')}
      trigger={
        <button
          type="button"
          data-testid="open-filters"
          className="inline-flex h-10 items-center gap-1.5 rounded-pill bg-panel px-3.5 text-[13px] font-semibold"
        >
          <SlidersHorizontal size={14} strokeWidth={2} aria-hidden />
          {t('filter')}
        </button>
      }
      headerAction={
        <button type="button" onClick={reset} className="text-sm text-muted underline">
          {t('clear')}
        </button>
      }
      footer={
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-busy={pending || undefined}
          className="h-[52px] w-full rounded-pill bg-ink text-[15px] font-semibold text-white"
        >
          {t('show', { count: total })}
        </button>
      }
    >
      <FilterPanel filters={filters} facets={facets} idPrefix="m" />
    </Sheet>
  );
}
