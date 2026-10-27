import {
  ADMIN_ORDER_TABS,
  type AdminOrderPageDto,
  type AdminOrderTab,
  formatTashkentHm,
  hasPermission,
  tashkentDayDiff,
} from '@forest/contracts/core';
import { Badge, Button, buttonClasses, cn, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess, PageHeader } from '../../../components/page';
import { AutoRefresh } from '../../../components/orders/auto-refresh';
import { CarrierLogo, OrderStatusBadge, PaymentCell } from '../../../components/orders/badges';
import { DELIVERY_STATUS_LABEL, SOURCE_LABEL, TAB_LABEL } from '../../../components/orders/copy';
import { ExportButton } from '../../../components/orders/export-button';
import { SlaCountdown } from '../../../components/orders/sla-countdown';
import { adminGet, requireFullSession } from '../../../lib/api';
import { formatWhen } from '../../../lib/format';

export const metadata: Metadata = { title: 'Buyurtmalar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

/** URL-synced filters (plain GET form: works without JS, shareable links). */
const FILTERS = [
  'q',
  'paymentMethod',
  'payment',
  'carrier',
  'source',
  'from',
  'to',
  'sort',
] as const;

function pick(sp: Search, key: string): string {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, 80) : '';
}

const selectClass =
  'h-10 rounded-pill border border-line bg-panel px-3.5 text-[13px] focus:border-ink focus:outline-none';

const soum = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return tashkentDayDiff(d, new Date()) === 0 ? formatTashkentHm(d) : formatWhen(iso);
}

/** A6 Buyurtmalar (docs/08): KPI tiles, status tabs with counts, filters, table, cursor pages. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'orders.view'))
    return (
      <>
        <PageHeader title="Buyurtmalar" />
        <NoAccess />
      </>
    );
  const sp = await searchParams;
  const filters = Object.fromEntries(FILTERS.map((k) => [k, pick(sp, k)])) as Record<
    (typeof FILTERS)[number],
    string
  >;
  const tabRaw = pick(sp, 'tab');
  const tab: AdminOrderTab = (ADMIN_ORDER_TABS as readonly string[]).includes(tabRaw)
    ? (tabRaw as AdminOrderTab)
    : 'all';
  const cursor = pick(sp, 'cursor');
  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  );
  const query = new URLSearchParams([...filterQuery, ['tab', tab], ['limit', '30']]);
  if (cursor) query.set('cursor', cursor);
  const page = await adminGet<AdminOrderPageDto>(`/admin/orders?${query.toString()}`);

  const hrefFor = (t: AdminOrderTab, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(filterQuery);
    if (t !== 'all') q.set('tab', t);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `/orders${q.size ? `?${q.toString()}` : ''}`;
  };
  const nextHref = page.nextCursor
    ? `/orders?${new URLSearchParams([...filterQuery, ['tab', tab], ['cursor', page.nextCursor]]).toString()}`
    : null;
  const canEdit = hasPermission(me.staff.role, 'orders.edit');
  const active = Object.values(filters).some(Boolean);
  const exportFilter = Object.fromEntries([...filterQuery, ['tab', tab]]);

  const tiles: { label: React.ReactNode; value: number; tone: string; href: string }[] = [
    {
      label: 'Yetkazishga tayyorlash',
      value: page.counts.to_pack,
      tone: 'bg-panel',
      href: hrefFor('to_pack'),
    },
    {
      label: (
        <>
          <CarrierLogo carrier="YANDEX" /> yo&apos;lda
        </>
      ),
      value: page.inTransitByCarrier.YANDEX,
      tone: 'bg-panel',
      href: hrefFor('in_transit', { carrier: 'YANDEX' }),
    },
    {
      label: (
        <>
          <CarrierLogo carrier="BTS" /> yo&apos;lda
        </>
      ),
      value: page.inTransitByCarrier.BTS,
      tone: 'bg-panel',
      href: hrefFor('in_transit', { carrier: 'BTS' }),
    },
    {
      label: 'SLA buzilish xavfi',
      value: page.counts.sla_risk,
      tone: 'bg-critical-bg text-critical',
      href: hrefFor('sla_risk'),
    },
    {
      label: "To'lov kutilmoqda",
      value: page.counts.awaiting_payment,
      tone: 'bg-warn-bg text-warn',
      href: hrefFor('awaiting_payment'),
    },
  ];

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Buyurtmalar"
        subtitle={`Hammasi ${page.counts.all} ta · Payme va Click to'lovlari avtomatik tasdiqlanadi · ro'yxat har daqiqada yangilanadi`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <ExportButton filter={exportFilter} />
            {canEdit ? (
              <Link href="/orders/new" prefetch={false} className={buttonClasses('primary')}>
                + Qo&apos;lda buyurtma
              </Link>
            ) : null}
          </div>
        }
      />

      <section
        aria-label="Ko'rsatkichlar"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5"
      >
        {tiles.map((t, i) => (
          <Link
            key={i}
            href={t.href}
            prefetch={false}
            className={cn(
              'flex flex-col gap-2.5 rounded-md p-[18px] hover:ring-2 hover:ring-line',
              t.tone,
            )}
          >
            <span className="inline-flex items-center gap-2 text-xs font-semibold">{t.label}</span>
            <b className="tabular text-[26px] font-semibold">{t.value}</b>
          </Link>
        ))}
      </section>

      <Panel as="section" className="flex flex-col gap-3.5 px-4 py-5 sm:px-6">
        <nav aria-label="Holat" className="flex flex-wrap gap-1.5 border-b border-line-soft pb-3.5">
          {ADMIN_ORDER_TABS.map((t) => (
            <Link
              key={t}
              href={hrefFor(t)}
              prefetch={false}
              aria-current={t === tab ? 'page' : undefined}
              data-testid={`tab-${t}`}
              className={cn(
                'rounded-pill px-3.5 py-2 text-[13px] font-semibold transition-colors',
                t === tab
                  ? 'bg-ink text-white'
                  : t === 'sla_risk' && page.counts.sla_risk > 0
                    ? 'bg-critical-bg text-critical'
                    : 'bg-canvas text-ink hover:bg-sage',
              )}
            >
              {TAB_LABEL[t]} <span className="opacity-70">{page.counts[t]}</span>
            </Link>
          ))}
        </nav>

        <form
          method="get"
          action="/orders"
          aria-label="Filtrlar"
          className="flex flex-wrap items-center gap-2"
        >
          {tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-pill bg-canvas px-4">
            <span className="sr-only">Qidiruv</span>
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="№, mijoz, telefon, trek raqami"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </label>
          <label>
            <span className="sr-only">To&apos;lov usuli</span>
            <select
              name="paymentMethod"
              defaultValue={filters.paymentMethod}
              className={selectClass}
            >
              <option value="">To&apos;lov: hammasi</option>
              <option value="PAYME">Payme</option>
              <option value="CLICK">Click</option>
              <option value="COD">Naqd</option>
            </select>
          </label>
          <label>
            <span className="sr-only">To&apos;lov holati</span>
            <select name="payment" defaultValue={filters.payment} className={selectClass}>
              <option value="">Holat: hammasi</option>
              <option value="paid">To&apos;langan</option>
              <option value="unpaid">To&apos;lanmagan</option>
              <option value="refunded">Qaytarilgan</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Yetkazish</span>
            <select name="carrier" defaultValue={filters.carrier} className={selectClass}>
              <option value="">Yetkazish: hammasi</option>
              <option value="YANDEX">Yandex</option>
              <option value="BTS">BTS</option>
              <option value="PICKUP">Olib ketish</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Manba</span>
            <select name="source" defaultValue={filters.source} className={selectClass}>
              <option value="">Manba: hammasi</option>
              <option value="web">Sayt</option>
              <option value="bot">Telegram bot</option>
              <option value="phone">Telefon</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            Dan
            <input type="date" name="from" defaultValue={filters.from} className={selectClass} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            Gacha
            <input type="date" name="to" defaultValue={filters.to} className={selectClass} />
          </label>
          <label>
            <span className="sr-only">Saralash</span>
            <select name="sort" defaultValue={filters.sort} className={selectClass}>
              <option value="">Yangilari oldin</option>
              <option value="created_asc">Eskilari oldin</option>
              <option value="sla_asc">SLA muddati bo&apos;yicha</option>
              <option value="total_desc">Summa bo&apos;yicha</option>
            </select>
          </label>
          <Button type="submit" size="sm">
            Ko&apos;rsatish
          </Button>
          {active ? (
            <Link
              href={tab === 'all' ? '/orders' : `/orders?tab=${tab}`}
              prefetch={false}
              className={buttonClasses('ghost', 'sm')}
            >
              Tozalash
            </Link>
          ) : null}
        </form>

        {page.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted" data-testid="orders-empty">
            {active || tab !== 'all'
              ? "Bu filtr bo'yicha buyurtma yo'q."
              : "Hozircha buyurtmalar yo'q. Saytdagi birinchi buyurtma shu yerda paydo bo'ladi."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  {[
                    '№',
                    'Vaqt',
                    'Mijoz',
                    'Mahsulotlar',
                    'Summa',
                    "To'lov",
                    'Yetkazish',
                    'Manba',
                    'Holat',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn('px-1.5 py-2.5 font-normal', h === 'Summa' && 'text-right')}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.items.map((o) => (
                  <tr key={o.id} className="border-b border-line-soft" data-testid="order-row">
                    <td className="px-1.5 py-3">
                      <Link
                        href={`/orders/${o.number}`}
                        prefetch={false}
                        className="font-semibold underline underline-offset-2 hover:text-forest"
                      >
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-1.5 py-3 text-muted">
                      <time dateTime={o.createdAt}>{timeLabel(o.createdAt)}</time>
                    </td>
                    <td className="px-1.5 py-3">
                      <span className="flex flex-col">
                        <b className="font-semibold">{o.customer.name}</b>
                        <span className="text-xs text-muted">
                          {o.customer.city} · {o.customer.phoneMasked}
                        </span>
                      </span>
                    </td>
                    <td
                      className="max-w-[240px] truncate px-1.5 py-3 text-ink-2"
                      title={o.itemsSummary}
                    >
                      {o.itemsSummary}
                    </td>
                    <td className="px-1.5 py-3 text-right font-semibold">{soum(o.totalSoum)}</td>
                    <td className="px-1.5 py-3">
                      <PaymentCell method={o.payment.method} status={o.payment.status} />
                    </td>
                    <td className="px-1.5 py-3">
                      <span className="flex flex-col gap-1">
                        <CarrierLogo carrier={o.carrier} />
                        {o.slaDueAt && o.sla ? (
                          <SlaCountdown dueAt={o.slaDueAt} serverNow={page.serverNow} />
                        ) : o.delivery.trackNumber ? (
                          <span className="text-xs text-muted">Trek: {o.delivery.trackNumber}</span>
                        ) : o.delivery.status !== 'NOT_CREATED' ? (
                          <span className="text-xs text-muted">
                            {DELIVERY_STATUS_LABEL[o.delivery.status]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </span>
                    </td>
                    <td className="px-1.5 py-3 text-xs text-ink-2">
                      {SOURCE_LABEL[o.source] ?? o.source}
                    </td>
                    <td className="px-1.5 py-3">
                      <OrderStatusBadge status={o.status} late={o.sla === 'LATE'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted">
            Telefonlar yashirilgan — to&apos;liq raqam buyurtma sahifasida (ko&apos;rish jurnalga
            yoziladi). Vaqt — Toshkent.
          </span>
          <span className="flex gap-2">
            {cursor ? (
              <Link href={hrefFor(tab)} prefetch={false} className={buttonClasses('outline', 'sm')}>
                Boshiga
              </Link>
            ) : null}
            {nextHref ? (
              <Link href={nextHref} prefetch={false} className={buttonClasses('outline', 'sm')}>
                Keyingi sahifa
              </Link>
            ) : null}
          </span>
        </div>
        {page.counts.sla_risk > 0 && tab !== 'sla_risk' ? (
          <Badge tone="critical" className="self-start">
            {page.counts.sla_risk} ta buyurtmada SLA muddati 1 soatdan kam qoldi
          </Badge>
        ) : null}
      </Panel>
    </>
  );
}
