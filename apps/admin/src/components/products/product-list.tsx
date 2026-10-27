'use client';

import type {
  AdminCategoryOptionDto,
  AdminProductPageDto,
  ProductStatus,
} from '@forest/contracts/core';
import { PRODUCT_STATUSES } from '@forest/contracts/core';
import { Badge, cn, Panel } from '@forest/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Icon, ICONS } from '../icon';
import { COPY, PRODUCT_STATUS_LABEL, PRODUCT_STATUS_TONE } from './copy';
import { soum } from './format';

interface Filters {
  q: string;
  category: string;
  status: string;
}

/** Builds `/products?…` keeping the other filters (URL is the filter state). */
export function productsHref(
  filters: Filters,
  patch: Partial<Filters & { id: string; cursor: string }>,
) {
  const q = new URLSearchParams();
  const next = { ...filters, ...patch };
  for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/products?${s}` : '/products';
}

/** A11 list: search (debounced, URL-synced), category chips, status filter, table, cursor pages. */
export function ProductList({
  page,
  categories,
  filters,
  cursor,
  selectedId,
}: {
  page: AdminProductPageDto;
  categories: AdminCategoryOptionDto[];
  filters: Filters;
  cursor: string;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (q === filters.q) return;
    const t = window.setTimeout(
      () => startTransition(() => router.replace(productsHref(filters, { q, cursor: '', id: '' }))),
      300,
    );
    return () => window.clearTimeout(t);
  }, [q, filters, router]);

  const keep = selectedId ? { id: selectedId } : {};
  return (
    <Panel as="section" className="flex min-w-0 flex-col gap-4 p-5 text-[13px] sm:p-[22px]">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-pill bg-canvas px-4">
          <Icon d={ICONS.search} size={16} className="text-subtle" />
          <span className="sr-only">{COPY.search}</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={COPY.search}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-subtle focus:outline-none"
            data-testid="product-search"
          />
        </label>
        <nav aria-label="Kategoriya" className="flex flex-wrap gap-1.5">
          {[
            { slug: '', label: COPY.all },
            ...categories.map((c) => ({ slug: c.slug, label: c.name.uz })),
          ].map((c) => (
            <Link
              key={c.slug || 'all'}
              href={productsHref(filters, { category: c.slug, cursor: '', ...keep })}
              prefetch={false}
              aria-current={filters.category === c.slug ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-pill px-4 font-semibold transition-colors',
                filters.category === c.slug ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage',
              )}
            >
              {c.label}
            </Link>
          ))}
        </nav>
        <label className="sr-only" htmlFor="product-status">
          Holat
        </label>
        <select
          id="product-status"
          value={filters.status}
          onChange={(e) =>
            startTransition(() =>
              router.replace(
                productsHref(filters, { status: e.target.value, cursor: '', ...keep }),
              ),
            )
          }
          className="h-9 rounded-pill bg-canvas px-3 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-forest"
        >
          <option value="">Barcha holatlar</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div
        className={cn('overflow-x-auto transition-opacity', pending && 'opacity-60')}
        aria-busy={pending}
      >
        {page.items.length === 0 ? (
          <div className="flex flex-col gap-1 rounded-md bg-off p-8 text-center">
            <b className="font-semibold">{COPY.empty}</b>
            <span className="text-muted">{COPY.emptyCta}</span>
          </div>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="px-2 py-2 font-normal">
                  Mahsulot
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  Variant
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  Narx
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  Qoldiq
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  Sotuv 30k
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Holat
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => {
                const selected = p.id === selectedId;
                const href = productsHref(filters, { id: p.id, cursor });
                return (
                  <tr
                    key={p.id}
                    data-testid="product-row"
                    className={cn(
                      'cursor-pointer border-b border-line-soft hover:bg-off',
                      selected && 'bg-[#F1F3EC]',
                    )}
                    onClick={() => router.push(href, { scroll: false })}
                  >
                    <td className="px-2 py-2.5">
                      <Link
                        href={href}
                        prefetch={false}
                        scroll={false}
                        aria-current={selected ? 'true' : undefined}
                        className="flex min-w-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-forest"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.image ? (
                          <Image
                            src={p.image.url}
                            alt=""
                            width={44}
                            height={44}
                            className="size-11 shrink-0 rounded-sm object-cover"
                            unoptimized
                          />
                        ) : (
                          <span aria-hidden className="size-11 shrink-0 rounded-sm bg-canvas" />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <b className="font-semibold leading-tight">{p.name.uz}</b>
                          <span className="text-xs text-muted">{p.sku}</span>
                          {p.missingIkpu > 0 ? (
                            <span className="text-[11px] font-semibold text-critical">
                              IKPU yo&apos;q: {p.missingIkpu}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">{p.variantCount}</td>
                    <td className="tabular px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                      {p.priceFromSoum === null
                        ? '—'
                        : `${p.priceVaries ? 'dan ' : ''}${soum(p.priceFromSoum)}`}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">
                      <span
                        className={cn(
                          'inline-flex min-w-8 justify-center rounded-pill px-2 py-0.5 font-semibold',
                          p.outOfStock
                            ? 'bg-critical-bg text-critical'
                            : p.lowStock
                              ? 'bg-warn-bg text-warn'
                              : '',
                        )}
                      >
                        {p.available}
                      </span>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">{p.sold30d}</td>
                    <td className="px-2 py-2.5">
                      <Badge tone={PRODUCT_STATUS_TONE[p.status as ProductStatus]}>
                        {PRODUCT_STATUS_LABEL[p.status as ProductStatus]}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cursor || page.nextCursor ? (
        <div className="flex justify-end gap-2">
          {cursor ? (
            <Link
              href={productsHref(filters, {})}
              prefetch={false}
              className="rounded-pill bg-canvas px-4 py-2 font-semibold hover:bg-sage"
            >
              {COPY.first}
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link
              href={productsHref(filters, { cursor: page.nextCursor })}
              prefetch={false}
              className="rounded-pill bg-ink px-4 py-2 font-semibold text-white"
            >
              {COPY.more}
            </Link>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
