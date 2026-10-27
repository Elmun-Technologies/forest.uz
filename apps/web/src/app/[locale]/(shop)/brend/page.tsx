import type { Locale } from '@forest/contracts';
import { cn } from '@forest/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArticleBlocks } from '@/components/content/article-blocks';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Link } from '@/i18n/navigation';
import { pageReady, routes, telegramUrl } from '@/config/site';
import { getBrandStory } from '@/lib/cms';
import { getSettings } from '@/lib/data';
import { alternates, metaDescription } from '@/lib/seo';
import { getSeoOverride, withSeoOverride } from '@/lib/seo-meta';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, override] = await Promise.all([
    getTranslations({ locale, namespace: 'brandPage' }),
    getSeoOverride(locale, routes.brand),
  ]);
  return withSeoOverride(
    {
      title: t('metaTitle'),
      description: metaDescription(t('metaDescription')),
      alternates: alternates(locale, routes.brand),
    },
    override,
  );
}

const VALUES = [1, 2, 3, 4] as const;
const PARTNERS = ['PAYME', 'CLICK', 'BTS', 'YANDEX'] as const;

/**
 * Brend (design Brend, CLAUDE.md §6): the design's final copy (messages), real partner logos, and
 * the CMS story ("Bizning yo'l") only once the owner publishes it — no `[placeholder]` text.
 * CTAs open the Telegram bot (partner / seller deep links), else call the store.
 */
export default async function BrandPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, story, settings] = await Promise.all([
    getTranslations('brandPage'),
    getBrandStory(locale),
    getSettings(locale),
  ]);
  const bot = settings?.store.telegramBot || null;
  const phone = settings?.store.phone || null;
  const contact = (start: string) =>
    bot ? telegramUrl(bot, start) : phone ? `tel:${phone}` : null;
  const cta =
    'inline-flex min-h-11 items-center rounded-pill px-5 text-[13px] font-semibold transition-colors';

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-4 lg:px-6 lg:pt-2">
      <section className="grid gap-8 px-3 py-8 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:gap-10 lg:px-10 lg:py-16">
        <div className="flex flex-col gap-8">
          <h1 className="text-[56px] leading-[0.9] font-medium tracking-[-0.06em] lg:text-[96px]">
            {t('titleTop')}
            <br />
            {t('titleBottom')}
          </h1>
          {pageReady.inspiration ? (
            <Link
              prefetch={false}
              href={routes.inspiration}
              className="flex items-center gap-3 text-sm font-semibold underline"
            >
              <span
                aria-hidden
                className="grid size-12 place-items-center rounded-pill border border-ink"
              >
                ▶
              </span>
              {t('projects')}
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">{t('whoTitle')}</h2>
          <p className="text-[15px] leading-relaxed text-muted">{t('whoText')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">{t('whyTitle')}</h2>
          <p className="text-[15px] leading-relaxed text-muted">{t('whyText')}</p>
        </div>
        <span
          aria-hidden
          className="hidden text-[96px] leading-none font-medium tracking-[-0.06em] lg:block"
        >
          01.
        </span>
      </section>

      <section className="flex flex-col gap-2.5 rounded-lg bg-panel p-3 lg:flex-row lg:gap-8 lg:rounded-xl lg:p-4">
        <div
          className={cn(
            'relative flex min-h-[280px] flex-col justify-end overflow-hidden rounded-[24px] p-6 text-white lg:min-h-[480px] lg:flex-[1_1_0] lg:p-8',
            story?.cover ? '' : 'bg-forest',
          )}
        >
          {story?.cover ? (
            <>
              <Image
                src={story.cover.url}
                alt={story.cover.alt}
                fill
                sizes="(min-width: 1024px) 680px, 100vw"
                className="object-cover"
              />
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent to-60%"
              />
            </>
          ) : null}
          <span className="relative text-sm text-[#E1E7DA]">{t('whatKicker')}</span>
          <span className="relative text-[36px] leading-none font-medium tracking-[-0.04em] lg:text-[56px]">
            {t('whatTitle')}
          </span>
        </div>
        <div className="flex flex-col gap-5 p-3 lg:flex-[1_1_0] lg:p-6">
          <h2 className="text-[28px] leading-[1.05] font-medium tracking-[-0.035em] lg:text-[40px]">
            {t('partnersTitle')}
          </h2>
          <ul className="grid grid-cols-2 border-t border-l border-line">
            {PARTNERS.map((k) => (
              <li
                key={k}
                className="grid h-24 place-items-center border-r border-b border-line p-4"
              >
                <Image
                  src={logos.light[k]}
                  alt={logoAlt[k]}
                  className="h-8 w-auto object-contain"
                  sizes="140px"
                />
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-relaxed text-muted">{t('partnersNote')}</p>
        </div>
      </section>

      <section
        aria-labelledby="path-title"
        className="flex flex-col gap-6 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-14 lg:py-12"
      >
        <h2
          id="path-title"
          className="border-y border-line py-6 text-[40px] leading-none font-medium tracking-[-0.05em] lg:text-[72px]"
        >
          {t('pathTitle')}
        </h2>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
          <p className="text-xl leading-snug lg:text-[26px]">{story?.excerpt || t('pathLead')}</p>
          {story ? <ArticleBlocks blocks={story.blocks} className="text-muted" /> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            prefetch={false}
            href={routes.catalog}
            className={cn(cta, 'bg-off hover:bg-sage-50')}
          >
            {t('toCatalog')}
          </Link>
          {contact('brand') ? (
            <a href={contact('brand')!} className={cn(cta, 'bg-ink text-white hover:bg-dark-3')}>
              {t('contact')}
            </a>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2.5 lg:flex-row lg:gap-4">
        <div className="flex flex-col gap-6 rounded-lg bg-ink p-7 text-white lg:flex-[1_1_0] lg:rounded-xl lg:p-10">
          <span className="text-xs text-on-dark-muted">{t('valuesKicker')}</span>
          <h2 className="border-b border-dark-3 pb-6 text-[36px] leading-none font-medium tracking-[-0.04em] lg:text-[56px]">
            {t('valuesTitle')}
          </h2>
          <p className="max-w-[420px] text-sm leading-relaxed text-[#C9D0C2]">{t('valuesLead')}</p>
          <span className="w-fit rounded-pill bg-white px-4 py-2 text-xs font-semibold text-ink">
            {t('valuesChip')}
          </span>
        </div>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:flex-[1_1_0] lg:gap-4">
          {VALUES.map((n) => (
            <li
              key={n}
              className="flex flex-col justify-between gap-6 rounded-lg border border-line bg-panel p-6 lg:rounded-[28px]"
            >
              <h3 className="text-xl font-semibold">{t(`value${n}Title`)}</h3>
              <p className="text-[13px] leading-relaxed text-muted">{t(`value${n}Text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2.5 lg:flex-row lg:gap-4">
        <div
          id="hamkorlik"
          className="flex flex-col justify-between gap-8 rounded-lg bg-sage-50 p-7 lg:min-h-[280px] lg:flex-[1_1_0] lg:rounded-xl lg:p-10"
        >
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold tracking-[0.08em] uppercase">
              {t('proKicker')}
            </span>
            <h2 className="text-[28px] leading-[1.05] font-medium tracking-[-0.035em] lg:text-[40px]">
              {t('proTitle')}
            </h2>
          </div>
          {contact('partner') ? (
            <a
              href={contact('partner')!}
              className={cn(cta, 'w-fit bg-ink text-white hover:bg-dark-3')}
            >
              {t('proCta')}
            </a>
          ) : null}
        </div>
        <div
          id="sotuvchi"
          className="flex flex-col justify-between gap-8 rounded-lg bg-forest p-7 text-white lg:min-h-[280px] lg:flex-[1_1_0] lg:rounded-xl lg:p-10"
        >
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold tracking-[0.08em] uppercase">
              {t('sellerKicker')}
            </span>
            <h2 className="text-[28px] leading-[1.05] font-medium tracking-[-0.035em] lg:text-[40px]">
              {t('sellerTitle')}
            </h2>
            <p className="text-sm text-[#E1E7DA]">{t('sellerText')}</p>
          </div>
          {contact('seller') ? (
            <a
              href={contact('seller')!}
              className={cn(cta, 'w-fit bg-white text-ink hover:bg-sage-50')}
            >
              {t('sellerCta')}
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}
