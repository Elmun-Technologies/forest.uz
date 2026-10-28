import type { Locale } from '@forest/contracts';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { UnsubscribeForm } from '@/components/unsubscribe/unsubscribe-form';

type Props = { params: Promise<{ locale: Locale; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'unsubscribe' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * `/{locale}/obuna/<token>` — the opt-out link every marketing SMS carries (docs/09). Nothing is
 * revoked on page load (link previews and scanners open URLs): the customer confirms with a button.
 */
export default async function UnsubscribePage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('unsubscribe');
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-xl bg-panel p-8">
        <h1 className="text-h3 font-medium">{t('title')}</h1>
        <p className="text-[15px] text-muted">{t('lead')}</p>
        <ClientMessages namespaces={['unsubscribe']}>
          <UnsubscribeForm token={token} />
        </ClientMessages>
      </section>
    </div>
  );
}
