import type { Locale } from '@forest/contracts';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { AddressBook } from '@/components/account/address-book';
import { getMyAddresses } from '@/lib/customer';

export default async function AddressesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [addresses, t] = await Promise.all([getMyAddresses(locale), getTranslations('account')]);
  return (
    <section className="flex flex-col gap-5 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-10 lg:py-9">
      <h1 className="text-[36px] font-medium tracking-[-0.04em] lg:text-5xl">{t('addresses')}</h1>
      <ClientMessages namespaces={['account']}>
        <AddressBook initial={addresses} />
      </ClientMessages>
    </section>
  );
}
