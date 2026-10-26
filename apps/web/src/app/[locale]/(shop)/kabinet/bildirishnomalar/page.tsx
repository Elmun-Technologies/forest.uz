import type { Locale } from '@forest/contracts';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { ConsentsForm } from '@/components/account/consents-form';
import { getMe } from '@/lib/customer';

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [me, t] = await Promise.all([getMe(locale), getTranslations('account')]);
  if (!me) return null;
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-10 lg:py-9">
      <h1 className="text-[36px] font-medium tracking-[-0.04em] lg:text-5xl">
        {t('notifications')}
      </h1>
      <p className="max-w-[640px] text-sm text-muted">{t('serviceNote')}</p>
      <ClientMessages namespaces={['account']}>
        <ConsentsForm initial={me.consents} />
      </ClientMessages>
    </section>
  );
}
