import type { Locale, OrderPublicDto, ProductCardDto } from '@forest/contracts';
import { formatTashkentDate } from '@forest/contracts/core';
import { cn, Price } from '@forest/ui';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ClientMessages } from '@/components/client-messages';
import { AddressBook } from '@/components/account/address-book';
import { OrdersTable } from '@/components/account/orders-table';
import { trackingPath } from '@/components/order/order-parts';
import { apiGet } from '@/lib/api';
import { getMe, getMyAddresses } from '@/lib/customer';
import { formatWhen } from '@/lib/format';

const ACTIVE = new Set(['NEW', 'CONFIRMED', 'PACKING', 'READY', 'HANDED_TO_COURIER']);

export default async function AccountPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await getMe(locale);
  if (!me) return null;
  const [orders, addresses, favorites, t, tc] = await Promise.all([
    apiGet<OrderPublicDto[]>('/me/orders', locale, { personal: true }),
    getMyAddresses(locale),
    apiGet<ProductCardDto[]>('/me/favorites', locale, { personal: true }),
    getTranslations('account'),
    getTranslations('common'),
  ]);
  const active = orders.find((o) => ACTIVE.has(o.status));
  const done = active ? active.timeline.filter((s) => s.state === 'done').length : 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-12 lg:py-10">
        <h1 className="text-[36px] leading-[0.95] font-medium tracking-[-0.05em] lg:text-[72px]">
          {me.name ? t('hello', { name: me.name }) : t('helloNoName')}
        </h1>
        <span className="text-sm text-muted">
          {t('since', { date: formatTashkentDate(new Date(me.customerSince)) })}
        </span>
      </div>

      <section className="flex flex-wrap gap-2.5 lg:gap-4">
        {active ? (
          <Link
            href={`/buyurtma/${active.publicId}`}
            data-testid="active-order"
            className="flex min-w-0 flex-[2_1_460px] flex-col gap-6 rounded-lg bg-forest p-6 text-white lg:rounded-[32px] lg:p-8"
          >
            <span className="flex flex-wrap justify-between gap-3">
              <span className="text-[13px] font-semibold tracking-[0.08em] text-sage uppercase">
                {t('activeOrder')}
              </span>
              <span className="tabular text-sm">№ {active.number}</span>
            </span>
            <span className="text-2xl font-medium tracking-[-0.03em] lg:text-[32px]">
              {active.slaDueAt
                ? t('activeBy', {
                    status: t(`status.${active.status}`),
                    when: formatWhen(tc, active.slaDueAt).toLowerCase(),
                  })
                : t(`status.${active.status}`)}
            </span>
            <span aria-hidden className="flex gap-1.5">
              {active.timeline.map((s, i) => (
                <span
                  key={s.key}
                  className={cn(
                    'h-1.5 flex-1 rounded-[3px]',
                    i < done ? 'bg-white' : 'bg-white/30',
                  )}
                />
              ))}
            </span>
            <span className="flex">
              {active.items.slice(0, 4).map((i, n) =>
                i.image ? (
                  <span
                    key={`${i.name}-${n}`}
                    className={cn(
                      'relative size-12 overflow-hidden rounded-pill border-2 border-forest',
                      n > 0 && '-ml-3',
                    )}
                  >
                    <Image src={i.image.url} alt="" fill sizes="48px" className="object-cover" />
                  </span>
                ) : null,
              )}
            </span>
          </Link>
        ) : null}
        <div className="flex min-w-0 flex-[1_1_140px] flex-col justify-between gap-8 rounded-lg bg-panel p-6 lg:rounded-[32px] lg:p-8">
          <span className="text-sm text-muted italic">{t('totalOrders')}</span>
          <span className="text-[56px] leading-none font-semibold tracking-[-0.04em]">
            {me.ordersCount}
          </span>
        </div>
        <Link
          href={`${routes.account}/sevimlilar`}
          className="flex min-w-0 flex-[1_1_140px] flex-col justify-between gap-8 rounded-lg bg-sage p-6 lg:rounded-[32px] lg:p-8"
        >
          <span className="text-sm italic">{t('inFavorites')}</span>
          <span className="text-[56px] leading-none font-semibold tracking-[-0.04em]">
            {me.favoritesCount}
          </span>
        </Link>
      </section>

      <ClientMessages namespaces={['account']}>
        <OrdersTable
          locale={locale}
          orders={orders.map((o) => ({ ...o, trackPath: trackingPath(o) }))}
        />
        <section className="flex flex-wrap gap-2.5 lg:gap-4">
          <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-10 lg:py-9">
            <div className="flex items-center justify-between">
              <h2 className="text-[28px] font-medium tracking-[-0.03em]">{t('addresses')}</h2>
              {addresses.length > 2 ? (
                <Link href={`${routes.account}/manzillar`} className="text-[13px] underline">
                  {t('all')}
                </Link>
              ) : null}
            </div>
            <AddressBook initial={addresses} compact />
          </div>
          <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-10 lg:py-9">
            <div className="flex items-center justify-between">
              <h2 className="text-[28px] font-medium tracking-[-0.03em]">{t('favorites')}</h2>
              {favorites.length ? (
                <Link href={`${routes.account}/sevimlilar`} className="text-[13px] underline">
                  {t('all')}
                </Link>
              ) : null}
            </div>
            {favorites.length ? (
              <ul className="grid grid-cols-2 gap-3">
                {favorites.slice(0, 2).map((p) => (
                  <li key={p.id}>
                    <Link href={routes.product(p.slug)} className="flex flex-col gap-2">
                      <span className="relative aspect-square overflow-hidden rounded-[20px] bg-canvas">
                        {p.image ? (
                          <Image
                            src={p.image.url}
                            alt=""
                            fill
                            sizes="240px"
                            className="object-cover"
                          />
                        ) : null}
                      </span>
                      <span className="text-sm font-semibold">{p.name}</span>
                      <Price
                        soum={p.priceFromSoum}
                        from={p.hasPriceRange}
                        locale={locale}
                        className="text-sm"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('noFavorites')}</p>
            )}
          </div>
        </section>
      </ClientMessages>
    </>
  );
}
