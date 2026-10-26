import type { Locale, ProductCardDto } from '@forest/contracts';
import { formatUzPhone } from '@forest/contracts/core';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { JsonLd } from '@/components/json-ld';
import { Hero } from '@/components/home/hero';
import { LeadSection } from '@/components/home/lead-section';
import { QuickSelector } from '@/components/home/quick-selector';
import {
  Bestsellers,
  DeliveryPayment,
  FactStrip,
  Gallery,
  HowToAndFaq,
  renderableFaq,
  ReviewsSummary,
  sectionTitle,
} from '@/components/home/sections';
import { telegramUrl } from '@/config/site';
import { apiGetOptional } from '@/lib/api';
import { getHomeContent, getSettings } from '@/lib/data';
import { absoluteUrl, alternates, siteUrl } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: alternates(locale, '/'),
    openGraph: { title: t('title'), description: t('description'), url: absoluteUrl(locale, '/') },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [content, settings, t] = await Promise.all([
    getHomeContent(locale),
    getSettings(locale),
    getTranslations('home.selector'),
  ]);
  // Until GET /content/home exists the page still sells: bestsellers come from the catalog.
  const bestsellers =
    content?.bestsellers ??
    (await apiGetOptional<ProductCardDto[]>('/catalog/bestsellers', locale)) ??
    [];
  const faq = renderableFaq(content?.faq ?? []);
  const store = settings?.store;
  const tg = store ? telegramUrl(store.telegramBot, 'home') : null;

  return (
    <ClientMessages namespaces={['home']}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-3 pt-0 lg:gap-6 lg:px-6 lg:pt-2">
        {store ? (
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: store.name,
              url: `${siteUrl()}/${locale}`,
              logo: `${siteUrl()}/brand/forest-logo-green.png`,
              email: store.email,
              telephone: formatUzPhone(store.phone),
              contactPoint: {
                '@type': 'ContactPoint',
                telephone: store.phone,
                contactType: 'customer service',
                availableLanguage: ['uz', 'ru'],
                areaServed: 'UZ',
              },
              sameAs: [
                telegramUrl(store.telegramBot),
                ...(store.instagram ? [store.instagram] : []),
              ],
            }}
          />
        ) : null}
        {faq.length > 0 ? (
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faq.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
              })),
            }}
          />
        ) : null}

        <Hero
          locale={locale}
          hero={content?.hero ?? null}
          reviews={content?.reviewsSummary ?? null}
          settings={settings}
          hasSelector={Boolean(content && content.selector.length > 0)}
          fallbackImage={
            content?.selector.find((s) => s.key === 'divan')?.image ??
            content?.selector.find((s) => s.image)?.image ??
            bestsellers.find((p) => p.image)?.image ??
            null
          }
        />
        <FactStrip />

        {content && content.selector.length > 0 ? (
          <section
            id="tanlash"
            aria-labelledby="selector-title"
            className="flex scroll-mt-4 flex-col gap-3.5 rounded-[28px] bg-panel px-3.5 pt-[22px] pb-3.5 lg:mt-6 lg:gap-8 lg:rounded-xl lg:p-12"
          >
            <div className="flex flex-col gap-4 px-1 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:border-b lg:border-line lg:px-0 lg:pb-7">
              <div className="flex flex-col gap-1.5 lg:gap-3">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase lg:text-[13px]">
                  {t('overline')}
                </span>
                <h2 id="selector-title" className={`${sectionTitle} text-[30px] leading-[1.05]`}>
                  {t('title')}
                </h2>
              </div>
              <p className="hidden max-w-[400px] text-base leading-relaxed text-muted lg:block">
                {t('text')}
              </p>
            </div>
            <QuickSelector items={content.selector} />
          </section>
        ) : null}

        <Gallery items={content?.gallery ?? []} />
        <ReviewsSummary summary={content?.reviewsSummary ?? null} />
        <Bestsellers products={bestsellers} locale={locale} />
        <HowToAndFaq howTo={content?.howTo ?? null} faq={faq} />
        <DeliveryPayment settings={settings} locale={locale} />
        <LeadSection image={content?.leadImage ?? null} telegramUrl={tg} />
      </div>
    </ClientMessages>
  );
}
