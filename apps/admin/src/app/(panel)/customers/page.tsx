import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SORTS,
  type CustomerFilterOptionsDto,
  type CustomerListDto,
  type CustomerSegment,
  hasPermission,
  UZ_REGIONS,
} from '@forest/contracts/core';
import { Badge, buttonClasses, cn, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  regionLabel,
  SEGMENT_BADGE,
  SEGMENT_HINT,
  SEGMENT_LABEL,
  SORT_LABEL,
  SOUM,
  sourceLabel,
} from '../../../components/customers/copy';
import { ExportCsvButton } from '../../../components/customers/export-csv-button';
import { NoAccess, PageHeader } from '../../../components/page';
import { AdminApiError, adminGet, requireFullSession } from '../../../lib/api';
import { formatLastSeen, initials } from '../../../lib/format';

export const metadata: Metadata = { title: 'Mijozlar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const FILTER_KEYS = ['q', 'region', 'source', 'productId', 'ltvMin', 'ltvMax', 'sort'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function pick(sp: Search, key: string, max = 80): string {
  const v = sp[key];
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

const fieldClass =
  'h-11 w-full rounded-pill border border-line bg-panel px-4 text-[13px] focus:border-ink focus:outline-none';

/** A4 Customers: segment chips, URL-synced filters (plain GET form), masked list, cursor pages. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'customers.view')) {
    return (
      <>
        <PageHeader title="Mijozlar" />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, pick(sp, k)])) as Record<
    FilterKey,
    string
  >;
  const segmentParam = pick(sp, 'segment');
  const segment: CustomerSegment = (CUSTOMER_SEGMENTS as readonly string[]).includes(segmentParam)
    ? (segmentParam as CustomerSegment)
    : 'all';
  const cursor = pick(sp, 'cursor', 200);

  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  );
  const query = new URLSearchParams(filterQuery);
  query.set('segment', segment);
  query.set('limit', '25');
  if (cursor) query.set('cursor', cursor);

  const [page, options] = await Promise.all([
    adminGet<CustomerListDto>(`/admin/customers?${query.toString()}`).catch((e: unknown) => {
      // A stale cursor or a garbage filter value (400): reload without it instead of failing.
      if (e instanceof AdminApiError && e.status === 400)
        redirect(cursor ? `/customers?${filterQuery.toString()}` : '/customers');
      throw e;
    }),
    adminGet<CustomerFilterOptionsDto>('/admin/customers/filters'),
  ]);

  const hrefWith = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(filterQuery);
    if (segment !== 'all') q.set('segment', segment);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return `/customers${s ? `?${s}` : ''}`;
  };
  const active = Object.entries(filters).some(([k, v]) => v && k !== 'sort');
  const canExport = hasPermission(me.staff.role, 'customers.export');

  return (
    <>
      <PageHeader
        title="Mijozlar"
        subtitle={
          <>
            {page.counts.all - page.counts.leads} xaridor · {page.counts.leads} lead · barcha
            ma&apos;lumot O&apos;zbekistondagi serverda
          </>
        }
        actions={
          canExport ? (
            <ExportCsvButton filters={{ ...filters, segment }} total={page.total} />
          ) : null
        }
      />

      <nav aria-label="Segmentlar" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {CUSTOMER_SEGMENTS.map((s) => {
          const selected = s === segment;
          return (
            <Link
              key={s}
              href={hrefWith({ segment: s === 'all' ? null : s, cursor: null })}
              prefetch={false}
              aria-current={selected ? 'page' : undefined}
              data-testid={`segment-${s}`}
              className={cn(
                'flex flex-col gap-1.5 rounded-md p-4 transition-colors',
                selected ? 'bg-ink text-white' : 'bg-panel hover:bg-sage-50',
              )}
            >
              <span className={cn('text-[13px]', selected ? 'text-on-dark-muted' : 'text-muted')}>
                {SEGMENT_LABEL[s]}
              </span>
              <span className="tabular text-[26px] leading-none font-medium tracking-[-0.03em]">
                {SOUM(page.counts[s])}
              </span>
              <span className={cn('text-[11px]', selected ? 'text-on-dark-muted' : 'text-muted')}>
                {SEGMENT_HINT[s]}
              </span>
            </Link>
          );
        })}
      </nav>

      <Panel as="section" className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <form
          method="get"
          action="/customers"
          aria-label="Filtrlar"
          className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4 "
        >
          {segment !== 'all' ? <input type="hidden" name="segment" value={segment} /> : null}
          <label className="flex flex-col gap-1">
            <span className="sr-only">Qidiruv</span>
            <input
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder="Ism, telefon yoki buyurtma raqami"
              className={cn(fieldClass, 'bg-canvas')}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Shahar</span>
            <select name="region" defaultValue={filters.region} className={fieldClass}>
              <option value="">Shahar: Hammasi</option>
              {UZ_REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.uz}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Birinchi manba</span>
            <select name="source" defaultValue={filters.source} className={fieldClass}>
              <option value="">Birinchi manba: Hammasi</option>
              {options.sources.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Sotib olgan mahsulot</span>
            <select name="productId" defaultValue={filters.productId} className={fieldClass}>
              <option value="">Sotib olgan: Istalgan</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">LTV dan (so&apos;m)</span>
            <input
              name="ltvMin"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={filters.ltvMin}
              placeholder="LTV dan"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="sr-only">LTV gacha (so&apos;m)</span>
            <input
              name="ltvMax"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={filters.ltvMax}
              placeholder="LTV gacha"
              className={fieldClass}
            />
          </label>
          <div className="flex items-center gap-2 lg:col-span-2">
            <label className="sr-only" htmlFor="customers-sort">
              Saralash
            </label>
            <select
              id="customers-sort"
              name="sort"
              defaultValue={filters.sort || 'activity'}
              className={cn(fieldClass, 'w-auto')}
            >
              {CUSTOMER_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClasses('primary', 'md')}>
              Ko&apos;rsatish
            </button>
            {active ? (
              <Link
                href={segment === 'all' ? '/customers' : `/customers?segment=${segment}`}
                prefetch={false}
                className={buttonClasses('ghost', 'md')}
              >
                Tozalash
              </Link>
            ) : null}
          </div>
        </form>

        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[980px] border-collapse text-left"
            data-testid="customers-table"
          >
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="px-2 py-2 font-normal">
                  Mijoz
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Shahar
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Birinchi manba
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  Xaridlar
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  LTV
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Oxirgi faollik
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Segment
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Rozilik
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((c) => {
                const badge = c.segments[0] ? SEGMENT_BADGE[c.segments[0]] : null;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-line-soft hover:bg-off"
                    data-testid="customer-row"
                  >
                    <td className="px-2 py-2.5">
                      <Link
                        href={`/customers/${c.id}`}
                        prefetch={false}
                        className="flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-forest"
                      >
                        <span
                          aria-hidden
                          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-sage text-xs font-bold"
                        >
                          {c.name ? initials(c.name) : '#'}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <b className="truncate font-semibold">
                            {c.name ?? c.phoneMasked ?? c.publicId}
                          </b>
                          <span className="tabular text-xs text-muted">
                            {c.name ? (c.phoneMasked ?? 'Telegram') : c.publicId}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-2 py-2.5">{regionLabel(c.region)}</td>
                    <td className="max-w-[200px] truncate px-2 py-2.5">
                      {sourceLabel(c.firstSource)}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">{c.purchases}</td>
                    <td className="tabular px-2 py-2.5 text-right font-semibold">
                      {c.ltvSoum ? SOUM(c.ltvSoum) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-muted">{formatLastSeen(c.lastActivityAt)}</td>
                    <td className="px-2 py-2.5">
                      {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <ConsentPill on={c.consents.sms} label="SMS" />
                        <ConsentPill on={c.consents.telegram} label="TG" />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {page.items.length === 0 ? (
            <p className="py-10 text-center text-muted">
              {active || segment !== 'all'
                ? "Bu filtrlar bo'yicha mijoz topilmadi."
                : "Hozircha mijozlar yo'q. Lead yoki buyurtma kelganda shu yerda ko'rinadi."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted" data-testid="customers-total">
            {page.items.length} ta ko&apos;rsatilmoqda, jami {SOUM(page.total)} · telefonlar
            yashirilgan
          </span>
          <span className="flex gap-2">
            {cursor ? (
              <Link
                href={hrefWith({ cursor: null })}
                prefetch={false}
                className={buttonClasses('outline', 'sm')}
              >
                Boshiga
              </Link>
            ) : null}
            {page.nextCursor ? (
              <Link
                href={hrefWith({ cursor: page.nextCursor })}
                prefetch={false}
                className={buttonClasses('outline', 'sm')}
              >
                Keyingi sahifa
              </Link>
            ) : null}
          </span>
        </div>
      </Panel>
    </>
  );
}

function ConsentPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={`${label}: ${on ? 'rozi' : "rozilik yo'q"}`}
      className={cn(
        'rounded-xs px-1.5 py-0.5 text-[10px] font-bold',
        on ? 'bg-good-bg text-good' : 'bg-canvas text-subtle line-through',
      )}
    >
      {label}
      <span className="sr-only">{on ? ' — rozi' : " — rozilik yo'q"}</span>
    </span>
  );
}
