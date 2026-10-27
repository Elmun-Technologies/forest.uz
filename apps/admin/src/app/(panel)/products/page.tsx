import {
  type AdminProductDto,
  type AdminProductPageDto,
  type AdminProductsMetaDto,
  hasPermission,
  PRODUCT_STATUSES,
} from '@forest/contracts/core';
import { KpiTile } from '@forest/ui';
import type { Metadata } from 'next';
import { NoAccess, PageHeader } from '../../../components/page';
import { COPY } from '../../../components/products/copy';
import { CreateProductButton } from '../../../components/products/create-product';
import { ProductEditor } from '../../../components/products/product-editor';
import { ProductList } from '../../../components/products/product-list';
import { AdminApiError, adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Mahsulotlar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const pick = (sp: Search, key: string, max = 96): string => {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, max) : '';
};

const SITE_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** A11: KPI tiles, URL-synced list (search, category, status, cursor) and the editor (?id=). */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'products.view')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const canEdit = hasPermission(me.staff.role, 'products.edit');
  const sp = await searchParams;
  const filters = {
    q: pick(sp, 'q', 80),
    category: pick(sp, 'category'),
    status: (PRODUCT_STATUSES as readonly string[]).includes(pick(sp, 'status'))
      ? pick(sp, 'status')
      : '',
  };
  const cursor = pick(sp, 'cursor', 200);
  const query = new URLSearchParams({ limit: '50' });
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  if (cursor) query.set('cursor', cursor);

  const [meta, page] = await Promise.all([
    adminGet<AdminProductsMetaDto>('/admin/products/meta'),
    adminGet<AdminProductPageDto>(`/admin/products?${query.toString()}`),
  ]);
  const selectedId = pick(sp, 'id', 64) || page.items[0]?.id || '';
  let product: AdminProductDto | null = null;
  if (selectedId) {
    try {
      product = await adminGet<AdminProductDto>(
        `/admin/products/${encodeURIComponent(selectedId)}`,
      );
    } catch (e) {
      if (!(e instanceof AdminApiError && e.status === 404)) throw e;
    }
  }
  const { kpis, locks } = meta;

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={
          locks.source === 'moysklad' || locks.price || locks.stock
            ? COPY.subtitleMoysklad
            : COPY.subtitleLocal
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {locks.source === 'moysklad' || locks.price || locks.stock ? (
              <span className="flex h-11 items-center gap-2 rounded-pill bg-panel px-4 text-[13px] font-semibold">
                <span aria-hidden className="size-2 rounded-full bg-live" />
                MoySklad ulangan
              </span>
            ) : null}
            {canEdit ? <CreateProductButton categories={meta.categories} /> : null}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={COPY.kpiActive}
          value={`${kpis.activeProducts} · ${kpis.activeVariants} variant`}
        />
        <KpiTile
          label={COPY.kpiLow}
          value={`${kpis.lowStockVariants} variant`}
          tone={kpis.lowStockVariants > 0 ? 'warn' : 'panel'}
        />
        <KpiTile
          label={COPY.kpiFeeds}
          value={`${kpis.feedsConnected} / ${kpis.feedsTotal}`}
          hint={COPY.kpiFeedsHint}
        />
        <KpiTile
          label={COPY.kpiIkpu}
          value={kpis.missingIkpuVariants}
          tone={kpis.missingIkpuVariants > 0 ? 'critical' : 'panel'}
          hint={kpis.missingIkpuVariants > 0 ? COPY.kpiIkpuHint : undefined}
        />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,480px)]">
        <ProductList
          page={page}
          categories={meta.categories}
          filters={filters}
          cursor={cursor}
          selectedId={product?.id ?? null}
        />
        {product ? (
          <ProductEditor
            key={product.id}
            initial={product}
            categories={meta.categories}
            canEdit={canEdit}
            siteUrl={SITE_URL}
            lowStockDefault={meta.lowStockDefault}
          />
        ) : (
          <div className="rounded-lg bg-panel p-8 text-sm text-muted">{COPY.pickProduct}</div>
        )}
      </div>
    </>
  );
}
