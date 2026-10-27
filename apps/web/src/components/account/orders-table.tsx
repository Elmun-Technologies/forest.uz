'use client';

import type { OrderPublicDto } from '@forest/contracts';
import { formatTashkentDate } from '@forest/contracts/core';
import { Chip, cn, Price } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';

const DONE = new Set(['DELIVERED', 'COMPLETED']);
const CLOSED = new Set(['DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED']);

export type OrderRow = OrderPublicDto & { trackPath: string };

/** "Buyurtmalar tarixi" with Hammasi / Faol / Yetkazilgan filter (design: Kabinet). */
export function OrdersTable({ orders, locale }: { orders: OrderRow[]; locale: 'uz' | 'ru' }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [filter, setFilter] = useState<'all' | 'active' | 'delivered'>('all');
  const rows = orders.filter((o) =>
    filter === 'all' ? true : filter === 'active' ? !CLOSED.has(o.status) : DONE.has(o.status),
  );
  const items = (o: OrderRow) =>
    o.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ');
  const status = (o: OrderRow) => (
    <span
      className={cn(
        'inline-flex rounded-pill px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap',
        CLOSED.has(o.status) ? 'bg-canvas text-ink' : 'bg-sage text-[#22301B]',
      )}
    >
      {t(`status.${o.status}`)}
    </span>
  );
  const action = (o: OrderRow) =>
    CLOSED.has(o.status) ? (
      <Link href={`/buyurtma/${o.publicId}`} className="text-[13px] underline">
        {t('open')}
      </Link>
    ) : (
      <a href={o.trackPath} className="text-[13px] underline">
        {t('track')}
      </a>
    );
  const payment = (o: OrderRow) =>
    o.paymentMethod === 'COD' ? (
      <span>{tc('payment.COD')}</span>
    ) : (
      <Logo
        src={logos.light[o.paymentMethod]}
        alt={logoAlt[o.paymentMethod]}
        className="h-[18px]"
      />
    );

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-panel p-5 lg:rounded-xl lg:px-10 lg:py-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-medium tracking-[-0.03em] lg:text-[32px]">{t('history')}</h2>
        <div role="group" aria-label={t('filter.label')} className="flex gap-2">
          {(['all', 'active', 'delivered'] as const).map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {t(`filter.${f}`)}
            </Chip>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-muted">{orders.length ? t('noOrdersFiltered') : t('noOrders')}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table
              className="tabular w-full min-w-[720px] border-collapse text-[15px]"
              data-testid="orders-table"
            >
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  {(['number', 'date', 'items', 'payment'] as const).map((c) => (
                    <th key={c} scope="col" className="border-b border-line px-2 py-3 font-medium">
                      {t(`col.${c}`)}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-line px-2 py-3 text-right font-medium">
                    {t('col.sum')}
                  </th>
                  <th scope="col" className="border-b border-line px-2 py-3 font-medium">
                    {t('col.status')}
                  </th>
                  <th scope="col" className="border-b border-line px-2 py-3">
                    <span className="sr-only">{t('col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.publicId} className="border-b border-line last:border-0">
                    <td className="px-2 py-[18px] font-semibold">
                      <Link href={`/buyurtma/${o.publicId}`} className="hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-2 py-[18px]">{formatTashkentDate(new Date(o.createdAt))}</td>
                    <td className="max-w-[320px] truncate px-2 py-[18px]">{items(o)}</td>
                    <td className="px-2 py-[18px]">{payment(o)}</td>
                    <td className="px-2 py-[18px] text-right font-semibold">
                      <Price soum={o.totalSoum} locale={locale} withCurrency={false} />
                    </td>
                    <td className="px-2 py-[18px]">{status(o)}</td>
                    <td className="px-2 py-[18px] text-right">{action(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2.5 md:hidden">
            {rows.map((o) => (
              <li key={o.publicId} className="flex flex-col gap-2 rounded-md bg-canvas p-4">
                <span className="flex items-center justify-between gap-2">
                  <Link href={`/buyurtma/${o.publicId}`} className="font-semibold">
                    {o.number}
                  </Link>
                  {status(o)}
                </span>
                <span className="text-sm text-muted">{items(o)}</span>
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">{formatTashkentDate(new Date(o.createdAt))}</span>
                  <Price soum={o.totalSoum} locale={locale} className="font-semibold" />
                </span>
                <span className="self-end">{action(o)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
