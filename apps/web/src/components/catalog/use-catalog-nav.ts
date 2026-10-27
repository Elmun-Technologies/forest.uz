'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { type CatalogFilters, catalogSearch } from '@/lib/catalog-params';

/** Pushes a new filter state to the URL (page reset to 1), keeping scroll position. */
export function useCatalogNav(filters: CatalogFilters) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  function apply(patch: Partial<CatalogFilters>) {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    startTransition(() => router.push(`${pathname}${catalogSearch(next)}`, { scroll: false }));
  }
  return {
    apply,
    pending,
    reset: () => startTransition(() => router.push(pathname, { scroll: false })),
  };
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
