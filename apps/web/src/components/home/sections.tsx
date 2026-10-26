import type {
  GalleryItemDto,
  HomeHowToDto,
  ProductCardDto,
  PublicSettingsDto,
  ReviewsSummaryDto,
} from '@forest/contracts';
import { containsPlaceholder } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import { ArrowRight, Play } from 'lucide-react';
import Image from 'next/image';
import { Logo } from '@/components/ui/logo';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { expressZone, regionsZone } from '@/lib/delivery';
import { ProductCard } from '@/components/product/product-card';
import { CheckIcon } from '@/components/layout/icons';
import { formatRating } from './hero';
import yandex from '../../../public/logos/yandex-delivery.png';
import bts from '../../../public/logos/bts.png';
import payme from '../../../public/logos/payme.png';
import click from '../../../public/logos/click.png';

export const sectionTitle =
  'text-[28px] leading-none font-medium tracking-[-0.035em] lg:text-[64px] lg:tracking-[-0.045em]';
const pillLink =
  'inline-flex items-center gap-2.5 rounded-pill bg-panel px-[22px] py-3 text-sm font-medium transition-colors hover:bg-sage-50';

/** Marketing facts strip (desktop). */
export async function FactStrip() {
  const t = await getTranslations('home.facts');
  const facts = [
    ['primerSmall', 'primerBig'],
    ['odourSmall', 'odourBig'],
    ['coatsSmall', 'coatsBig'],
    ['euSmall', 'euBig'],
  ] as const;
  return (
    <ul className="hidden flex-wrap gap-4 md:flex">
      {facts.map(([small, big], i) => {
        const dark = i === facts.length - 1;
        return (
          <li
            key={big}
            className={cn(
              'flex flex-[1_1_280px] items-center justify-between gap-4 rounded-pill px-9 py-[22px]',
              dark ? 'bg-forest text-white' : 'bg-panel',
            )}
          >
            <span
              className={cn(
                'text-sm leading-[1.35] whitespace-pre-line italic',
                dark ? 'text-sage' : 'text-muted',
              )}
            >
              {t(small)}
            </span>
            <span className="text-[30px] font-semibold tracking-[-0.03em] whitespace-nowrap">
              {t(big)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Customer before/after results — rendered only with real, consented photos. */
export async function Gallery({ items }: { items: GalleryItemDto[] }) {
  const t = await getTranslations('home.gallery');
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="gallery-title" className="flex flex-col gap-3 pt-3 lg:gap-6 lg:pt-12">
      <h2 id="gallery-title" className={cn(sectionTitle, 'px-1.5 lg:px-0')}>
        <span className="lg:hidden">{t('titleShort')}</span>
        <span className="hidden lg:inline">{t('title')}</span>
      </h2>
      <ul className="-mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] lg:gap-4 lg:overflow-visible lg:px-0">
        {items.map((g) => (
          <li
            key={g.title}
            className="flex w-[280px] shrink-0 snap-start flex-col gap-2.5 rounded-[24px] bg-panel px-2 pt-2 pb-3.5 lg:w-auto lg:gap-3.5 lg:rounded-[32px] lg:px-3 lg:pt-3 lg:pb-[22px]"
          >
            <div className="relative h-[200px] overflow-hidden rounded-[18px] lg:aspect-[4/3] lg:h-auto lg:rounded-[24px]">
              <Image
                src={g.after.url}
                alt={g.after.alt}
                fill
                sizes="(min-width: 1024px) 450px, 280px"
                className="object-cover"
              />
              {g.before ? (
                <>
                  <Image
                    src={g.before.url}
                    alt={g.before.alt}
                    fill
                    sizes="(min-width: 1024px) 450px, 280px"
                    className="object-cover [clip-path:inset(0_50%_0_0)]"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-white lg:-ml-[1.5px] lg:w-[3px]"
                  />
                  <span className="absolute top-3.5 left-3.5 hidden rounded-pill bg-ink/72 px-3 py-1.5 text-xs font-semibold text-white lg:block">
                    {t('before')}
                  </span>
                  <span className="absolute top-3.5 right-3.5 hidden rounded-pill bg-white px-3 py-1.5 text-xs font-semibold lg:block">
                    {t('after')}
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 px-1.5 lg:px-2.5">
              <h3 className="text-sm font-semibold lg:text-lg">{g.title}</h3>
              <p className="hidden text-[13px] text-muted lg:block">{g.meta}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Rating summary + latest verified reviews. The whole block exists only with real reviews. */
export async function ReviewsSummary({ summary }: { summary: ReviewsSummaryDto | null }) {
  const t = await getTranslations('home.reviews');
  if (!summary || summary.count === 0) return null;
  const avg = formatRating(summary.average);
  const first = summary.latest[0];
  return (
    <section
      id="sharhlar"
      aria-label={t('overline')}
      className="flex scroll-mt-6 flex-col gap-4 lg:mt-6 lg:flex-row lg:flex-wrap"
    >
      <div className="flex min-w-0 flex-col gap-3.5 rounded-[28px] bg-forest p-[22px] text-white lg:flex-[1_1_320px] lg:gap-5 lg:rounded-xl lg:p-10">
        <h2 className="hidden text-[13px] font-semibold tracking-[0.08em] text-sage uppercase lg:block">
          {t('overline')}
        </h2>
        <p className="flex items-baseline gap-2 lg:gap-2.5">
          <b className="text-[52px] leading-none font-medium tracking-[-0.04em] lg:text-[96px] lg:tracking-[-0.05em]">
            {avg}
          </b>
          <span className="text-sm text-sage lg:hidden">
            {t('basisShort', { count: summary.count })}
          </span>
          <span className="hidden text-sage lg:inline">{t('outOf')}</span>
        </p>
        <p className="hidden text-[15px] text-[#E1E7DA] lg:block">
          {t('basis', { count: summary.count })}
        </p>
        <ul className="mt-auto hidden flex-col gap-2 text-[13px] lg:flex">
          {summary.distribution
            .slice()
            .sort((a, b) => b.stars - a.stars)
            .map((d) => (
              <li key={d.stars} className="tabular flex items-center gap-2.5">
                <span aria-label={t('stars', { stars: d.stars })}>{d.stars}</span>
                <span aria-hidden className="h-1.5 flex-1 rounded-[3px] bg-white/18">
                  <span
                    className="block h-full rounded-[3px] bg-white"
                    style={{ width: `${d.pct}%` }}
                  />
                </span>
                <span className="w-9 text-right">{d.pct}%</span>
              </li>
            ))}
        </ul>
        {first ? (
          <figure className="flex flex-col gap-2 rounded-[18px] bg-white/8 p-4 lg:hidden">
            <figcaption className="flex justify-between text-[13px]">
              <b>{first.author}</b>
              <span className="text-sage">{t('verifiedShort')}</span>
            </figcaption>
            <blockquote className="text-sm leading-[1.55] text-[#E1E7DA]">{first.text}</blockquote>
          </figure>
        ) : null}
      </div>
      {summary.latest.length > 0 ? (
        <ul className="hidden min-w-0 grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 lg:grid lg:flex-[3_1_760px]">
          {summary.latest.slice(0, 3).map((r, i) => (
            <li
              key={`${r.author}-${i}`}
              className="flex flex-col gap-4 rounded-[32px] bg-panel px-3.5 pt-3.5 pb-[26px]"
            >
              {r.image ? (
                <Image
                  src={r.image.url}
                  alt={r.image.alt}
                  width={r.image.width ?? 640}
                  height={r.image.height ?? 400}
                  sizes="300px"
                  className="aspect-[16/10] w-full rounded-[22px] object-cover"
                />
              ) : null}
              <figure className="flex flex-col gap-2.5 px-2.5">
                <figcaption className="flex items-center justify-between gap-2">
                  <b className="text-[15px]">
                    {r.author}
                    {r.city ? `, ${r.city}` : ''}
                  </b>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest">
                    <CheckIcon />
                    {t('verified')}
                  </span>
                </figcaption>
                <blockquote className="text-[15px] leading-[1.55]">{r.text}</blockquote>
                <span className="text-xs text-muted">{r.productName}</span>
              </figure>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export async function Bestsellers({
  products,
  locale,
}: {
  products: ProductCardDto[];
  locale: 'uz' | 'ru';
}) {
  const t = await getTranslations('home.bestsellers');
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="bestsellers" className="flex flex-col gap-3 pt-3 lg:gap-7 lg:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1.5 lg:px-0">
        <h2 id="bestsellers" className={sectionTitle}>
          {t('title')}
        </h2>
        <Link href={routes.catalog} className={cn(pillLink, 'hidden lg:inline-flex')}>
          {t('all')}
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <ul
        data-testid="bestsellers"
        className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] lg:gap-4"
      >
        {products.slice(0, 4).map((p) => (
          <li key={p.id}>
            <ProductCard product={p} locale={locale} look="home" list="home_bestsellers" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** FAQ answers may carry `{settings.vars}` if the API couldn't resolve them — never render those. */
function isRenderable(item: { q: string; a: string }) {
  const text = `${item.q} ${item.a}`;
  return !containsPlaceholder(text) && !/\{[\w.]+\}/.test(text);
}

export function renderableFaq(faq: { q: string; a: string }[]) {
  return faq.filter(isRenderable);
}

export async function HowToAndFaq({
  howTo,
  faq,
}: {
  howTo: HomeHowToDto | null;
  faq: { q: string; a: string }[];
}) {
  const t = await getTranslations('home');
  const items = renderableFaq(faq);
  const video = howTo?.videoUrl && howTo.poster ? howTo : null;
  if (!video && items.length === 0) return null;
  return (
    <section className="flex flex-col gap-4 lg:mt-12 lg:flex-row lg:flex-wrap">
      {video?.poster && video.videoUrl ? (
        <a
          href={video.videoUrl}
          target="_blank"
          rel="noopener"
          data-track="video_play"
          className="relative hidden min-h-[520px] min-w-0 flex-[1_1_460px] overflow-hidden rounded-xl text-white lg:block"
        >
          <Image
            src={video.poster.url}
            alt={video.poster.alt}
            fill
            sizes="660px"
            className="object-cover"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-ink/85 to-ink/10 to-60%"
          />
          <span className="absolute top-[42%] left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill bg-white text-ink">
            <Play size={30} fill="currentColor" aria-hidden />
            <span className="sr-only">{t('howTo.play')}</span>
          </span>
          <span className="absolute inset-x-9 bottom-9 flex flex-col gap-3.5">
            <span className="text-[40px] leading-[1.05] font-medium tracking-[-0.035em]">
              {t('howTo.title')}
            </span>
            <span className="text-sm text-[#E1E7DA]">
              {video.durationMinutes
                ? t('howTo.meta', { minutes: video.durationMinutes })
                : t('howTo.metaNoDuration')}
            </span>
          </span>
        </a>
      ) : null}
      {items.length > 0 ? (
        <div className="flex min-w-0 flex-col rounded-[28px] bg-panel px-5 pt-5 pb-2 lg:flex-[1_1_520px] lg:gap-2 lg:rounded-xl lg:px-11 lg:py-10">
          <h2 className="mb-2 text-2xl font-medium tracking-[-0.03em] lg:mb-4 lg:text-[40px] lg:leading-[1.05] lg:tracking-[-0.04em]">
            {t('faq.title')}
          </h2>
          {items.map((f, i) => (
            <details
              key={f.q}
              open={i === 0}
              className={cn(
                'group border-t border-line py-3.5 lg:py-[18px]',
                i === items.length - 1 && 'lg:border-b',
              )}
            >
              <summary className="cursor-pointer text-[15px] font-semibold marker:text-ink lg:text-[17px]">
                {f.q}
              </summary>
              <p className="mt-2 text-sm leading-[1.55] text-muted lg:mt-2.5 lg:text-base lg:leading-relaxed">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export async function DeliveryPayment({
  settings,
  locale,
}: {
  settings: PublicSettingsDto | null;
  locale: 'uz' | 'ru';
}) {
  const t = await getTranslations('home.delivery');
  if (!settings) return null;
  const express = expressZone(settings);
  const regions = regionsZone(settings);
  const card =
    'flex min-w-0 items-center gap-3 lg:flex-[1_1_320px] lg:gap-6 lg:rounded-[32px] lg:bg-panel lg:px-8 lg:py-7';
  const logoBox =
    'grid h-11 w-24 shrink-0 place-items-center rounded-[14px] bg-canvas lg:h-16 lg:w-[150px] lg:rounded-[20px]';
  return (
    <section
      aria-label={t('payment')}
      className="order-last flex flex-col gap-3 rounded-[28px] bg-panel p-[18px] lg:order-none lg:flex-row lg:flex-wrap lg:gap-4 lg:rounded-none lg:bg-transparent lg:p-0"
    >
      {express ? (
        <div className={card}>
          <span className={logoBox}>
            <Image src={yandex} alt="Yandex Dostavka" width={124} className="w-20 lg:w-[124px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-1 text-[13px] leading-[1.4] lg:text-sm">
            <b className="font-semibold lg:text-lg">
              <span className="lg:hidden">
                {t('tashkentShort', { hours: express.promiseHours })}
              </span>
              <span className="hidden lg:inline">
                {t('tashkent', { eta: express.etaLabel[locale] })}
              </span>
            </b>
            <span className="text-muted">
              <span className="lg:hidden">{t('tashkentTextShort')}</span>
              <span className="hidden lg:inline">{t('tashkentText')}</span>
            </span>
          </span>
        </div>
      ) : null}
      {regions ? (
        <div className={card}>
          <span className={logoBox}>
            <Logo src={bts} alt="BTS" className="h-8 lg:h-[46px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-1 text-[13px] leading-[1.4] lg:text-sm">
            <b className="font-semibold lg:text-lg">
              <span className="lg:hidden">
                {t('republicShort', { hours: regions.promiseHours })}
              </span>
              <span className="hidden lg:inline">
                {t('republic', { eta: regions.etaLabel[locale] })}
              </span>
            </b>
            <span className="text-muted">
              <span className="lg:hidden">{t('republicTextShort')}</span>
              <span className="hidden lg:inline">{t('republicText')}</span>
            </span>
          </span>
        </div>
      ) : null}
      <div className="hidden min-w-0 flex-[1_1_320px] flex-col justify-center gap-3.5 rounded-[32px] bg-panel px-8 py-7 lg:flex">
        <h2 className="text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">
          {t('payment')}
        </h2>
        <span className="flex flex-wrap items-center gap-5">
          <Logo src={payme} alt="Payme" className="h-7" />
          <Logo src={click} alt="Click" className="h-[26px]" />
          {settings.flags.cod ? (
            <span className="rounded-pill border border-line px-3 py-1.5 text-[13px] font-semibold">
              {t('cod')}
            </span>
          ) : null}
        </span>
      </div>
    </section>
  );
}
