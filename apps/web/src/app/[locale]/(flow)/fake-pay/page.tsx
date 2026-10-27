import type { ApiErrorBody, Locale, OrderPublicDto } from '@forest/contracts';
import { Price } from '@forest/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { FakePayActions } from '@/components/fake-pay/fake-pay-actions';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { redirect } from '@/i18n/navigation';
import { ApiError, apiGet, apiRequest } from '@/lib/api';

// Per-request page: the [locale] layout's generateStaticParams would otherwise mark it static,
// and its cookie/searchParams read would fail at runtime (DYNAMIC_SERVER_USAGE).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The API has no public "fake mode" flag, so we ask the fake callback itself: with an unknown
 * order it answers ORDER_NOT_FOUND when fake providers are on and a bare 404 (NOT_FOUND) when
 * they are off. The probe has no side effects.
 */
async function fakeModeOn(): Promise<boolean> {
  try {
    const res = await apiRequest('/dev/fake-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: 'probe-0000', result: 'fail' }),
    });
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return body?.error.code === 'ORDER_NOT_FOUND';
  } catch {
    return false;
  }
}

/** `/{locale}/fake-pay?provider=payme&order=<publicId>` — dev/demo stand-in for Payme/Click. */
export default async function FakePayPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const publicId = typeof sp.order === 'string' ? sp.order : '';
  if (!publicId || !(await fakeModeOn())) notFound();

  let order: OrderPublicDto;
  try {
    order = await apiGet<OrderPublicDto>(`/orders/${encodeURIComponent(publicId)}`, locale, {
      personal: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  // Nothing to pay (COD, already paid, expired): the `return` query is ignored on purpose —
  // we only ever send the customer to our own order page (no open redirect).
  if (order.paymentMethod === 'COD' || !order.canRetryPayment)
    redirect({ href: `/buyurtma/${order.publicId}`, locale });

  const method = order.paymentMethod === 'CLICK' ? 'CLICK' : 'PAYME';
  const t = await getTranslations('fakePay');
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <section className="flex w-full max-w-[460px] flex-col gap-6 rounded-xl bg-panel p-8">
        <Logo src={logos.light[method]} alt={logoAlt[method]} className="h-8 self-start" />
        <h1 className="text-h3 font-medium">{t('title', { provider: logoAlt[method] })}</h1>
        <p className="rounded-sm bg-warn-bg px-4 py-3 text-[13px] font-semibold text-warn">
          {t('note')}
        </p>
        <p className="tabular font-semibold">{t('order', { number: order.number })}</p>
        <dl className="tabular flex flex-col gap-2 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-muted">{t('amount')}</dt>
            <dd className="text-xl font-semibold">
              <Price soum={order.totalSoum} locale={locale} />
            </dd>
          </div>
        </dl>
        <ClientMessages namespaces={['fakePay']}>
          <FakePayActions publicId={order.publicId} />
        </ClientMessages>
      </section>
    </div>
  );
}
