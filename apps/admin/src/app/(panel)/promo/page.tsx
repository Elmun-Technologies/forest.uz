import {
  type AdminPromoDto,
  type AdminPromoPageDto,
  type AdminPromoSummaryDto,
  hasPermission,
} from '@forest/contracts/core';
import { Badge, buttonClasses, cn, KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess, PageHeader } from '../../../components/page';
import { compactSoum, soum } from '../../../components/products/format';
import { AUDIENCE_SHORT, COPY, STATE_LABEL, STATE_TONE } from '../../../components/promo/copy';
import { PromoEditor } from '../../../components/promo/promo-editor';
import { discountLabel } from '../../../components/promo/promo-format';
import { adminGet, requireFullSession } from '../../../lib/api';

export const metadata: Metadata = { title: 'Promo-kodlar · Forest Admin' };

type Search = Record<string, string | string[] | undefined>;
const pick = (sp: Search, key: string, max = 64) => {
  const v = sp[key];
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/** A14: KPIs (30 days), codes table with stats, editor (?id= or ?id=new), automatic promotions. */
export default async function PromoPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireFullSession();
  if (!hasPermission(me.staff.role, 'promo.edit')) {
    return (
      <>
        <PageHeader title={COPY.title} />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const cursor = pick(sp, 'cursor', 200);
  const [summary, page] = await Promise.all([
    adminGet<AdminPromoSummaryDto>('/admin/promo/summary'),
    adminGet<AdminPromoPageDto>(
      `/admin/promo?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  ]);
  const id = pick(sp, 'id') || page.items[0]?.id || 'new';
  const selected: AdminPromoDto | null =
    id === 'new'
      ? null
      : (page.items.find((p) => p.id === id) ??
        (await adminGet<AdminPromoDto>(`/admin/promo/${encodeURIComponent(id)}`).catch(
          () => null,
        )));
  const { kpis, automatic, rules } = summary;

  return (
    <>
      <PageHeader
        title={COPY.title}
        subtitle={COPY.subtitle}
        actions={
          <Link
            href="/promo?id=new"
            prefetch={false}
            className={buttonClasses('primary', 'md')}
            data-testid="promo-new"
          >
            {COPY.add}
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={`${COPY.kpiOrders} · ${summary.periodDays} kun`}
          value={kpis.ordersWithCodePct === null ? '—' : `${kpis.ordersWithCodePct}%`}
        />
        <KpiTile
          label={COPY.kpiDiscount}
          value={compactSoum(kpis.discountSoum)}
          hint={`${summary.periodDays} kun`}
        />
        <KpiTile
          label={COPY.kpiRevenue}
          value={compactSoum(kpis.revenueSoum)}
          hint={`${summary.periodDays} kun`}
        />
        <KpiTile
          label={COPY.kpiSuspicious}
          value={kpis.suspicious}
          tone={kpis.suspicious > 0 ? 'warn' : 'panel'}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,460px)]">
        <Panel
          as="section"
          className="flex min-w-0 flex-col gap-3 p-5 text-[13px] sm:p-[22px]"
          aria-label="Promo-kodlar"
        >
          {page.items.length === 0 ? (
            <p className="rounded-md bg-off p-8 text-center text-muted">{COPY.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th scope="col" className="px-2 py-2 font-normal">
                      Kod
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Chegirma
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Manba
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      Ishlatildi
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      Daromad
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Holat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        'border-b border-line-soft',
                        p.id === selected?.id && 'bg-[#F1F3EC]',
                      )}
                      data-testid="promo-row"
                    >
                      <td className="px-2 py-2.5">
                        <Link
                          href={`/promo?id=${p.id}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`}
                          prefetch={false}
                          scroll={false}
                          aria-current={p.id === selected?.id ? 'true' : undefined}
                          className="flex flex-col focus-visible:outline-2 focus-visible:outline-forest"
                        >
                          <b className="font-mono text-sm font-bold">{p.code}</b>
                          <span className="text-xs text-muted">{AUDIENCE_SHORT[p.audience]}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 font-semibold whitespace-nowrap">
                        {discountLabel(p)}
                      </td>
                      <td className="px-2 py-2.5">{p.utmSource ? `utm=${p.utmSource}` : '—'}</td>
                      <td className="tabular px-2 py-2.5 text-right">
                        {p.stats.uses}
                        {p.stats.suspicious > 0 ? (
                          <span className="block text-[11px] font-semibold text-warn">
                            {p.stats.suspicious} shubhali
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                        {p.stats.revenueSoum > 0 ? compactSoum(p.stats.revenueSoum) : '—'}
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.nextCursor ? (
            <Link
              href={`/promo?cursor=${encodeURIComponent(page.nextCursor)}`}
              prefetch={false}
              className="self-end rounded-pill bg-ink px-4 py-2 font-semibold text-white"
            >
              Keyingi sahifa
            </Link>
          ) : null}
        </Panel>
        <PromoEditor key={selected?.id ?? 'new'} promo={selected} summary={summary} />
      </div>

      <Panel
        as="section"
        className="flex flex-col gap-4 p-5 sm:p-[22px]"
        aria-labelledby="auto-promos"
      >
        <h2 id="auto-promos" className="text-xl font-semibold">
          {COPY.automatic}{' '}
          <span className="text-[13px] font-normal text-muted">· {COPY.automaticHint}</span>
        </h2>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-md bg-[#F1F3EC] p-4 text-[13px]">
            <b className="text-[15px] font-semibold">{COPY.freeShipping}</b>
            {automatic.freeShipping.map((z) => (
              <span key={z.zone.uz} className="text-muted">
                {z.zone.uz}: {z.freeFromSoum === null ? '—' : `${soum(z.freeFromSoum)}+`}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1 rounded-md bg-[#F1F3EC] p-4 text-[13px]">
            <b className="text-[15px] font-semibold">{COPY.kits}</b>
            {automatic.kits.length === 0 ? <span className="text-muted">{COPY.noKits}</span> : null}
            {automatic.kits.map((k) => (
              <span key={k.productId} className="text-muted">
                {k.name.uz}: {soum(k.priceSoum)} (−{k.savingPct}%)
              </span>
            ))}
            <span className="text-xs text-muted">{COPY.kitsNote}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md bg-off p-4 text-[13px]">
            <b className="text-[15px] font-semibold">{COPY.secondGift}</b>
            <span className="text-muted">
              {automatic.secondPurchaseGift.enabled ? 'yoqilgan' : COPY.off}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted">
          Marja himoyasi: {rules.maxDiscountPct}% (Sozlamalar). Bu bo&apos;lim hozircha faqat
          ko&apos;rish uchun.
        </p>
      </Panel>
    </>
  );
}
