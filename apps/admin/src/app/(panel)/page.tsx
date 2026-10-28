import {
  type DashboardDto,
  DASHBOARD_PERIODS,
  hasPermission,
  type KpisDto,
} from '@forest/contracts/core';
import { Badge, buttonClasses, cn, KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChannelList, Empty, FunnelBars, SegmentLinks } from '../../components/analytics/blocks';
import {
  attentionText,
  INT,
  kpiDelta,
  PCT,
  SOUM_FULL,
  SOUM_SHORT,
} from '../../components/analytics/copy';
import { VisitsChart } from '../../components/analytics/visits-chart';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../../components/customers/copy';
import { AutoRefresh } from '../../components/orders/auto-refresh';
import { PageHeader, Section } from '../../components/page';
import { adminGet, requireFullSession } from '../../lib/api';
import { formatLongDate, formatWhen } from '../../lib/format';
import { navFor, settingsTabsFor } from '../../lib/nav';

export const metadata: Metadata = { title: 'Dashboard · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;

const TONE = {
  critical: 'critical',
  warning: 'warn',
  good: 'sage',
  info: 'panel',
} as const;

function KpiGrid({ k }: { k: KpisDto }) {
  const tiles = [
    {
      id: 'sessions',
      raw: k.sessions.value,
      label: 'Tashriflar',
      value: INT(k.sessions.value),
      delta: kpiDelta(k.sessions),
    },
    {
      id: 'visitors',
      raw: k.visitors.value,
      label: 'Unikal tashrifchilar',
      value: INT(k.visitors.value),
      delta: kpiDelta(k.visitors),
    },
    {
      id: 'cr',
      raw: k.conversionRate.value,
      label: 'Konversiya',
      value: k.sessions.value ? PCT(k.conversionRate.value) : '—',
      delta: k.sessions.value ? kpiDelta(k.conversionRate, 'pp') : null,
    },
    {
      id: 'orders',
      raw: k.orders.value,
      label: 'Buyurtmalar',
      value: INT(k.orders.value),
      delta: kpiDelta(k.orders),
    },
    {
      id: 'revenue',
      raw: k.revenueSoum.value,
      label: 'Daromad',
      value: SOUM_SHORT(k.revenueSoum.value),
      delta: kpiDelta(k.revenueSoum),
    },
    {
      id: 'aov',
      raw: k.aovSoum.value,
      label: "O'rtacha chek",
      value: k.orders.value ? SOUM_FULL(k.aovSoum.value) : '—',
      delta: k.orders.value ? kpiDelta(k.aovSoum) : null,
    },
    {
      id: 'leads',
      raw: k.leads.value,
      label: 'Leadlar',
      value: INT(k.leads.value),
      delta: kpiDelta(k.leads),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="kpis">
      {tiles.map((t) => (
        <div key={t.id} data-testid={`kpi-${t.id}`} data-value={t.raw} className="contents">
          <KpiTile label={t.label} value={t.value} delta={t.delta} />
        </div>
      ))}
    </div>
  );
}

/**
 * A1 Dashboard (docs/08): realtime count, KPIs vs the previous period, visits, attention list,
 * funnel, traffic sources, latest orders, top products. Analytics blocks only with
 * `analytics.view` (the API returns null otherwise); every number is SQL over our own data.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  const sp = await searchParams;
  const daysParam = Number(typeof sp.days === 'string' ? sp.days : 30);
  const days = (DASHBOARD_PERIODS as readonly number[]).includes(daysParam) ? daysParam : 30;
  const d = await adminGet<DashboardDto>(`/admin/dashboard?days=${days}`);
  const analytics = d.kpis !== null;

  const shortcuts = analytics
    ? []
    : [
        ...navFor(me.staff.role)
          .flatMap((g) => g.items)
          .filter((i) => i.href && i.href !== '/' && i.href !== '/settings')
          .map((i) => ({ href: i.href as string, label: i.label })),
        ...settingsTabsFor(me.staff.role).map((t) => ({
          href: t.href,
          label: `Sozlamalar · ${t.label}`,
        })),
      ];

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Dashboard"
        subtitle={formatLongDate()}
        actions={
          analytics ? (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex h-11 items-center gap-2 rounded-pill bg-panel px-4 text-[13px] font-semibold"
                data-testid="active-now"
              >
                <span aria-hidden className="size-2 rounded-full bg-live" />
                {INT(d.activeNow ?? 0)} kishi hozir saytda
              </span>
              <SegmentLinks
                label="Davr"
                items={DASHBOARD_PERIODS.map((n) => ({
                  href: `/?days=${n}`,
                  label: `${n} kun`,
                  active: n === days,
                }))}
              />
              <Link
                href={`/analytics?days=${days}`}
                prefetch={false}
                className={buttonClasses('primary', 'md')}
              >
                Hisobot
              </Link>
            </div>
          ) : null
        }
      />

      {d.kpis ? <KpiGrid k={d.kpis} /> : null}

      <div
        className={cn(
          'grid gap-4',
          analytics && 'xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]',
        )}
      >
        {d.visits ? (
          <Section
            title="Tashriflar"
            actions={
              <span className="text-xs text-muted">kunlik sessiyalar, oxirgi {days} kun</span>
            }
          >
            <VisitsChart points={d.visits} />
          </Section>
        ) : null}
        <Section title="Diqqat talab qiladi">
          {d.attention.length === 0 ? (
            <Empty>Hozircha shoshilinch ish yo&apos;q.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5" data-testid="attention">
              {d.attention.map((a) => {
                const text = attentionText(a);
                const body = (
                  <Panel tone={TONE[a.severity]} radius="md" className="flex flex-col gap-0.5 p-4">
                    <b className="font-semibold">{text.title}</b>
                    <span className="text-ink-2">{text.detail}</span>
                  </Panel>
                );
                return (
                  <li key={a.kind}>
                    {text.href ? (
                      <Link href={text.href} prefetch={false} className="block hover:opacity-90">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      {d.funnel && d.channels ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title="Savdo voronkasi"
            actions={
              <Link
                href={`/analytics?tab=funnel&days=${days}`}
                prefetch={false}
                className="text-xs underline"
              >
                Batafsil
              </Link>
            }
          >
            <FunnelBars steps={d.funnel} testId="funnel" />
          </Section>
          <Section
            title="Trafik manbalari"
            actions={<span className="text-xs text-muted">sessiya · konversiya · daromad</span>}
          >
            <ChannelList rows={d.channels} />
          </Section>
        </div>
      ) : null}

      {d.latestOrders || d.topProducts ? (
        <div
          className={cn(
            'grid gap-4',
            d.topProducts && d.latestOrders && 'xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]',
          )}
        >
          {d.latestOrders ? (
            <Section
              title="So'nggi buyurtmalar"
              actions={
                <Link href="/orders" prefetch={false} className="text-xs underline">
                  Hammasi
                </Link>
              }
            >
              {d.latestOrders.length === 0 ? (
                <Empty>Buyurtmalar hali yo&apos;q.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="py-2 font-medium">№</th>
                        <th className="py-2 font-medium">Mijoz</th>
                        <th className="py-2 font-medium">To&apos;lov</th>
                        <th className="py-2 text-right font-medium">Summa</th>
                        <th className="py-2 pl-3 font-medium">Holat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.latestOrders.map((o) => (
                        <tr key={o.number} className="border-t border-line-soft">
                          <td className="py-2.5">
                            <Link
                              href={`/orders/${encodeURIComponent(o.number)}`}
                              prefetch={false}
                              className="font-semibold underline underline-offset-2"
                            >
                              {o.number}
                            </Link>
                            <span className="block text-xs text-muted">
                              {formatWhen(o.createdAt)}
                            </span>
                          </td>
                          <td className="py-2.5">{o.customerName ?? '—'}</td>
                          <td className="py-2.5">
                            <b className="font-semibold">{PAYMENT_METHOD[o.paymentMethod]}</b>
                            {o.paymentStatus ? (
                              <span className="block text-xs text-muted">
                                {PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus}
                              </span>
                            ) : null}
                          </td>
                          <td className="tabular py-2.5 text-right font-semibold">
                            {SOUM_FULL(o.totalSoum)} so&apos;m
                          </td>
                          <td className="py-2.5 pl-3">
                            <Badge tone={ORDER_STATUS[o.status]?.tone ?? 'neutral'}>
                              {ORDER_STATUS[o.status]?.label ?? o.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          ) : null}
          {d.topProducts ? (
            <Section title="Top mahsulotlar">
              {d.topProducts.length === 0 ? (
                <Empty>Bu davrda xaridlar yo&apos;q.</Empty>
              ) : (
                <ul className="flex flex-col" data-testid="top-products">
                  {d.topProducts.map((p) => (
                    <li
                      key={p.productId}
                      className="flex items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0"
                    >
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          width={44}
                          height={44}
                          className="size-11 shrink-0 rounded-xs object-cover"
                        />
                      ) : (
                        <span aria-hidden className="size-11 shrink-0 rounded-xs bg-canvas" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate font-semibold">{p.name}</b>
                        <span className="text-xs text-muted">
                          {INT(p.units)} dona · {PCT(p.conversionRate)} konversiya
                        </span>
                      </span>
                      <b className="tabular font-semibold">{SOUM_SHORT(p.revenueSoum)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
        </div>
      ) : null}

      {shortcuts.length > 0 ? (
        <Panel className="flex flex-col gap-3 p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Ish bo&apos;limlari</h2>
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                prefetch={false}
                className="rounded-pill bg-canvas px-4 py-2 text-[13px] font-semibold hover:bg-sage"
              >
                {t.label}
              </Link>
            ))}
          </div>
          {!hasPermission(me.staff.role, 'analytics.view') ? (
            <p className="text-xs text-muted">
              Analitika ko&apos;rsatkichlari egasi, menejer va marketolog uchun ochiq.
            </p>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
