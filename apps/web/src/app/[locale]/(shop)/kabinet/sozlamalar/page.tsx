import type { Locale } from '@forest/contracts';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { ProfileForm } from '@/components/account/profile-form';
import { getMe } from '@/lib/customer';
import { getSettings } from '@/lib/data';

// Per-request page: the [locale] layout's generateStaticParams would otherwise mark it static,
// and its cookie/searchParams read would fail at runtime (DYNAMIC_SERVER_USAGE).
export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [me, settings, t] = await Promise.all([
    getMe(locale),
    getSettings(locale),
    getTranslations('account'),
  ]);
  if (!me) return null;
  return (
    <>
      <h1 className="sr-only">{t('settings')}</h1>
      <ClientMessages namespaces={['account', 'telegram']}>
        <ProfileForm me={me} telegramBot={settings?.auth?.telegramBot ?? null} />
      </ClientMessages>
    </>
  );
}
