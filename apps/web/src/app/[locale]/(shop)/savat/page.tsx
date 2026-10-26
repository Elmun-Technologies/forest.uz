import type { Locale } from '@forest/contracts';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { CartView } from '@/components/cart/cart-view';
import { ClientMessages } from '@/components/client-messages';
import { FlowSteps } from '@/components/flow/flow-steps';
import { MobileFlowMarker } from '@/components/layout/shop-chrome';
import { getCategories, getSettings } from '@/lib/data';
import { alternates } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cartPage' });
  return {
    title: t('title'),
    alternates: alternates(locale, routes.cart),
    robots: { index: false, follow: false },
  };
}

/** `/{locale}/savat` (design: Savat, Mobil-Savat). The cart itself is client state (cookie). */
export default async function CartPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tc, settings, categories] = await Promise.all([
    getTranslations('cartPage'),
    getTranslations('common'),
    getSettings(locale),
    getCategories(locale),
  ]);
  // Empty state shows the two "what are you renewing?" entry points with real category photos.
  const tiles = categories
    .filter((c) => c.image)
    .slice(0, 2)
    .map((c) => ({ slug: c.slug, name: c.name, image: c.image }));

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-3 pb-6 lg:px-6 lg:pt-2 lg:pb-16">
      <MobileFlowMarker />
      <section className="hidden flex-wrap items-end justify-between gap-4 rounded-xl bg-panel px-12 py-10 lg:flex">
        <div className="flex flex-col gap-4">
          <nav aria-label={tc('breadcrumb')} className="text-[13px] text-muted">
            <Link href={routes.home} className="hover:text-ink">
              {tc('home')}
            </Link>{' '}
            / <span aria-current="page">{t('title')}</span>
          </nav>
          <h1 className="text-display font-medium">{t('title')}</h1>
        </div>
        <FlowSteps current={1} />
      </section>
      <ClientMessages namespaces={['cartPage']}>
        <CartView
          locale={locale}
          returnDays={settings?.returns.returnDays ?? null}
          cod={settings?.flags.cod ?? false}
          tiles={tiles}
        />
      </ClientMessages>
    </div>
  );
}
