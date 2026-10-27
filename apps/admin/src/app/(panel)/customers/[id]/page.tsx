import { type CustomerDetailDto, formatTashkentDate, hasPermission } from '@forest/contracts/core';
import { Badge, KpiTile, Panel } from '@forest/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  CONSENT_CHANNEL_LABEL,
  CONSENT_SOURCE_LABEL,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  regionLabel,
  SEGMENT_BADGE,
  SOUM,
  sourceLabel,
} from '../../../../components/customers/copy';
import {
  DataActions,
  NotesPanel,
  RevealPii,
  TagsEditor,
} from '../../../../components/customers/customer-actions';
import { CustomerTimeline } from '../../../../components/customers/customer-timeline';
import { NoAccess, PageHeader } from '../../../../components/page';
import { AdminApiError, adminGet, requireFullSession } from '../../../../lib/api';
import { initials } from '../../../../lib/format';

export const metadata: Metadata = { title: 'Mijoz · Forest Admin' };

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel as="section" className="flex flex-col gap-2 p-5 text-[13px] sm:p-[22px]">
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </Panel>
  );
}

const date = (iso: string) => formatTashkentDate(new Date(iso));

/** A5 Customer 360° (basic): no analytics blocks until first-party tracking exists (Phase 4). */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireFullSession();
  const role = me.staff.role;
  if (!hasPermission(role, 'customers.view')) {
    return (
      <>
        <PageHeader title="Mijoz" />
        <NoAccess />
      </>
    );
  }
  const { id } = await params;
  let c: CustomerDetailDto;
  try {
    c = await adminGet<CustomerDetailDto>(`/admin/customers/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  }
  const erased = c.erasedAt !== null;
  const badge = c.segments[0] ? SEGMENT_BADGE[c.segments[0]] : null;
  const title = erased ? "O'chirilgan mijoz" : (c.name ?? c.phoneMasked ?? c.publicId);
  const consentAt = (channel: string) => c.consents.history.find((h) => h.channel === channel);
  const canOrders = hasPermission(role, 'orders.view');

  return (
    <>
      <nav aria-label="Yo'l" className="px-1 text-[13px] text-muted">
        <Link href="/customers" prefetch={false} className="underline underline-offset-2">
          Mijozlar
        </Link>{' '}
        / {title}
      </nav>

      <Panel tone="dark" className="flex flex-wrap items-center gap-5 p-6 sm:p-7">
        <span
          aria-hidden
          className="grid size-[72px] shrink-0 place-items-center rounded-full bg-forest text-[28px] font-semibold text-white"
        >
          {c.name && !erased ? initials(c.name) : '#'}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="flex flex-wrap items-center gap-3 text-[30px] font-medium tracking-[-0.03em]">
            {title}
            {badge && !erased ? (
              <Badge tone="sage" className="text-forest">
                {badge.label}
              </Badge>
            ) : null}
          </h1>
          <p className="text-[13px] text-on-dark-muted" data-testid="customer-summary">
            {[
              c.name ? (c.phoneMasked ?? (c.hasTelegram ? 'Telegram orqali' : null)) : null,
              c.region ? regionLabel(c.region) : null,
              `mijoz ${date(c.createdAt)} dan`,
              `ID ${c.publicId}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {!erased ? <TagsEditor customerId={c.id} tags={c.tags} editable /> : null}
        </div>
        {!erased && hasPermission(role, 'customers.pii') ? <RevealPii customerId={c.id} /> : null}
      </Panel>

      {erased ? (
        <Panel tone="warn" radius="md" className="p-4 text-[13px]" role="status">
          Ma&apos;lumotlar {date(c.erasedAt!)} da o&apos;chirilgan (anonimlashtirilgan). Buyurtmalar
          qonun bo&apos;yicha kontaktlarsiz saqlanadi.
        </Panel>
      ) : c.erasureRequest ? (
        <Panel tone="warn" radius="md" className="p-4 text-[13px]" role="status">
          Mijoz {date(c.erasureRequest.requestedAt)} da ma&apos;lumotlarini o&apos;chirishni
          so&apos;radi — {date(c.erasureRequest.dueBy)} gacha bajarilishi kerak.
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="LTV (umumiy xarid)"
          value={SOUM(c.kpis.ltvSoum)}
          hint="so'm, qaytarishlarsiz"
        />
        <KpiTile label="Xaridlar" value={c.kpis.purchases} hint="to'langan buyurtmalar" />
        <KpiTile
          label="O'rtacha chek"
          value={c.kpis.aovSoum !== null ? SOUM(c.kpis.aovSoum) : '—'}
          hint="so'm"
        />
        <KpiTile label="Jami buyurtmalar" value={c.kpis.ordersTotal} hint="to'lanmaganlari bilan" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <Card title="Mijoz yo'li">
          <CustomerTimeline items={c.timeline} />
          <p className="pt-1 text-xs text-muted">
            Sayt tashriflari va reklama bosishlari analitika ishga tushgach ko&apos;rinadi.
          </p>
        </Card>

        <div className="flex flex-col gap-4">
          {c.firstTouch || c.firstSource ? (
            <Card title="Atributsiya">
              <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Birinchi manba</dt>
                <dd className="font-semibold">
                  {sourceLabel(c.firstTouch?.source ?? c.firstSource)}
                </dd>
                {c.firstTouch?.medium ? (
                  <>
                    <dt className="text-muted">Kanal</dt>
                    <dd>{c.firstTouch.medium}</dd>
                  </>
                ) : null}
                {c.firstTouch?.campaign ? (
                  <>
                    <dt className="text-muted">Kampaniya</dt>
                    <dd className="break-all">{c.firstTouch.campaign}</dd>
                  </>
                ) : null}
              </dl>
            </Card>
          ) : null}

          <Card
            title="Buyurtmalar"
            aside={<span className="text-xs text-muted">{c.orders.length} ta</span>}
          >
            {c.orders.length === 0 ? <p className="text-muted">Buyurtmalar yo&apos;q.</p> : null}
            <ul className="flex flex-col" data-testid="customer-orders">
              {c.orders.map((o) => (
                <li
                  key={o.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line-soft py-2.5"
                >
                  <span className="flex flex-col">
                    {canOrders ? (
                      <Link
                        href={`/orders?q=${encodeURIComponent(o.number)}`}
                        prefetch={false}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {o.number}
                      </Link>
                    ) : (
                      <b className="font-semibold">{o.number}</b>
                    )}
                    <span className="text-xs text-muted">{date(o.createdAt)}</span>
                  </span>
                  <span className="tabular text-right font-semibold">{SOUM(o.totalSoum)}</span>
                  <span className="text-xs">
                    <b className="font-semibold">{PAYMENT_METHOD[o.paymentMethod]}</b>
                    {o.paymentStatus ? (
                      <span className={o.paymentStatus === 'PAID' ? ' text-good' : ' text-muted'}>
                        {' '}
                        · {PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right">
                    <Badge tone={ORDER_STATUS[o.status]?.tone ?? 'neutral'}>
                      {ORDER_STATUS[o.status]?.label ?? o.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Rozilik va ma'lumotlar">
            <dl
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5"
              data-testid="customer-consents"
            >
              {(
                [
                  ['SMS_MARKETING', c.consents.current.smsMarketing],
                  ['TELEGRAM', c.consents.current.telegram],
                  ['ADS_MATCHING', c.consents.current.adsMatching],
                ] as const
              ).map(([channel, on]) => {
                const last = consentAt(channel);
                return (
                  <div key={channel} className="contents">
                    <dt>{CONSENT_CHANNEL_LABEL[channel]}</dt>
                    <dd className={on ? 'font-semibold text-good' : 'text-muted'}>
                      {on ? 'Rozi' : "Rozilik yo'q"}
                      {last
                        ? ` · ${date(last.at)} · ${CONSENT_SOURCE_LABEL[last.source] ?? last.source}`
                        : ''}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-xs text-muted">
              Xizmat xabarlari (buyurtma holati) roziliksiz yuboriladi; marketing — faqat rozilik
              bilan.
            </p>
            {!erased ? (
              <DataActions
                customerId={c.id}
                publicId={c.publicId}
                canExport={hasPermission(role, 'customers.export')}
                canErase={hasPermission(role, 'customers.erase')}
                openOrders={c.openOrders}
              />
            ) : null}
          </Card>

          {!erased ? (
            <Card title="Ichki izohlar">
              <NotesPanel customerId={c.id} notes={c.notes} editable />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
