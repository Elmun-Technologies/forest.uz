import type { Locale } from '@forest/contracts';
import { formatUzPhone } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { ClientMessages } from '@/components/client-messages';
import { FlowHeader } from '@/components/flow/flow-header';
import { routes } from '@/config/site';
import { getMe, getMyAddresses } from '@/lib/customer';
import { getSettings } from '@/lib/data';
import { alternates } from '@/lib/seo';

// Per-request page: the [locale] layout's generateStaticParams would otherwise mark it static,
// and its cookie/searchParams read would fail at runtime (DYNAMIC_SERVER_USAGE).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return {
    title: t('metaTitle'),
    alternates: alternates(locale, routes.checkout),
    robots: { index: false, follow: false },
  };
}

/** `/{locale}/checkout` (design: Checkout, Mobil-Checkout). Identified customers get prefilled. */
export default async function CheckoutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [settings, me] = await Promise.all([getSettings(locale), getMe(locale)]);
  const addresses = me ? await getMyAddresses(locale) : [];

  return (
    <>
      <FlowHeader phone={settings?.store.phone ? formatUzPhone(settings.store.phone) : null} />
      <ClientMessages namespaces={['checkout']}>
        <CheckoutForm
          offerVersion={settings?.store.offerVersion ?? ''}
          codEnabled={settings?.flags.cod ?? false}
          codMaxSoum={settings?.delivery.codMaxSoum ?? null}
          prefill={{ name: me?.name ?? null, phone: me?.phone ?? null, addresses }}
        />
      </ClientMessages>
    </>
  );
}
