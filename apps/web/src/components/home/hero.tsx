import type {
  HomeHeroDto,
  ImageDto,
  PublicSettingsDto,
  ReviewsSummaryDto,
} from '@forest/contracts';
import { BeforeAfter, Button, cn, Price, Rating } from '@forest/ui';
import { ArrowDown, ChevronsLeftRight } from 'lucide-react';
import Image from 'next/image';
import { Logo } from '@/components/ui/logo';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { expressZone } from '@/lib/delivery';
import { StarIcon } from '@/components/layout/icons';
import yandex from '../../../public/logos/yandex-delivery.png';
import payme from '../../../public/logos/payme.png';
import click from '../../../public/logos/click.png';

/** `4,9` — both UZ and RU use a decimal comma. */
export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/**
 * Hero: offer + before/after slider. On mobile everything sits in one white card (chip, title,
 * slider, text, CTA, trust row); on desktop the slider is its own panel — `contents` + `order`
 * keep a single DOM (one set of images) for both layouts.
 */
export async function Hero({
  locale,
  hero,
  reviews,
  settings,
  hasSelector,
  fallbackImage,
}: {
  locale: 'uz' | 'ru';
  hasSelector: boolean;
  /** Real catalog/selector photo used when no before/after pair is configured yet. */
  fallbackImage: ImageDto | null;
  hero: HomeHeroDto | null;
  reviews: ReviewsSummaryDto | null;
  settings: PublicSettingsDto | null;
}) {
  const t = await getTranslations('home');
  const express = settings ? expressZone(settings) : undefined;
  // `?.`: tolerate a cached settings payload from before `returns` existed.
  const returnDays = settings?.returns?.returnDays;
  const b = (chunks: React.ReactNode) => <b className="font-bold text-ink">{chunks}</b>;

  return (
    <section
      aria-labelledby="hero-title"
      className="flex flex-col gap-4 rounded-[28px] bg-panel px-[18px] pt-[22px] pb-[18px] lg:flex-row lg:flex-wrap lg:rounded-none lg:bg-transparent lg:p-0"
    >
      <div
        className={cn(
          'contents lg:flex lg:min-h-[680px] lg:min-w-0 lg:flex-col lg:justify-between lg:gap-9 lg:rounded-xl lg:bg-panel lg:px-[52px] lg:py-12',
          hero || fallbackImage ? 'lg:flex-[1_1_500px]' : 'lg:flex-1',
        )}
      >
        <div className="contents lg:flex lg:flex-col lg:gap-7">
          {reviews ? (
            <a
              href="#sharhlar"
              className="order-1 inline-flex items-center gap-1.5 self-start rounded-pill border border-line py-1.5 pr-3 pl-3 text-xs font-medium text-ink-2 lg:gap-2.5 lg:py-2 lg:pr-4 lg:pl-2.5 lg:text-[13px]"
            >
              <Rating
                value={reviews.average}
                label={t('ratingLabel', { value: formatRating(reviews.average) })}
                className="hidden lg:inline-flex"
              />
              <StarIcon size={12} className="text-forest lg:hidden" />
              <b className="text-ink">{formatRating(reviews.average)}</b>·
              <span className="hidden lg:inline">{t('ratingChip', { count: reviews.count })}</span>
              <span className="lg:hidden">{t('ratingChipShort', { count: reviews.count })}</span>
            </a>
          ) : null}
          <h1
            id="hero-title"
            className="order-2 text-[44px] leading-[0.98] font-medium tracking-[-0.045em] lg:text-[84px] lg:leading-[0.96] lg:tracking-[-0.05em]"
          >
            <span className="lg:block">{t('titleLine1')}</span>{' '}
            <span className="lg:flex lg:items-center lg:gap-5">
              <span
                aria-hidden
                className="hidden h-2 w-[88px] rounded-[4px] bg-ink lg:inline-block"
              />
              {t('titleLine2')}
            </span>{' '}
            <span className="text-forest lg:block">{t('titleLine3')}</span>
          </h1>
          <p className="order-4 max-w-[450px] text-[15px] leading-[1.55] text-muted lg:text-lg">
            <span className="lg:hidden">{t('heroTextMobile')}</span>
            <span className="hidden lg:inline">{t('heroText')}</span>
          </p>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-5 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="h-14 w-full text-base lg:h-auto lg:w-auto lg:px-[30px] lg:py-5"
            >
              {hasSelector ? (
                <a href="#tanlash" data-track="hero_cta_selector">
                  {t('ctaSelect')}
                  <ArrowDown size={18} strokeWidth={2} aria-hidden className="hidden lg:block" />
                </a>
              ) : (
                <Link href={routes.catalog} data-track="hero_cta_selector">
                  {t('ctaSelect')}
                </Link>
              )}
            </Button>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="hidden border-[1.5px] text-base lg:inline-flex lg:h-auto lg:px-[26px] lg:py-[18px]"
            >
              <Link href={routes.catalog}>{t('ctaPrices')}</Link>
            </Button>
          </div>
          <ul className="order-6 flex items-center justify-between gap-2 text-xs text-muted lg:flex-wrap lg:justify-start lg:gap-x-5 lg:gap-y-3 lg:border-t lg:border-line lg:pt-[22px] lg:text-[13px]">
            {express ? (
              <li className="inline-flex items-center gap-1.5 lg:gap-2">
                <Logo src={yandex} alt="Yandex Dostavka" className="h-2.5 lg:h-[13px]" />
                <span>{t.rich('trustDelivery', { hours: express.promiseHours, b })}</span>
              </li>
            ) : null}
            <li aria-hidden className="hidden h-[18px] w-px bg-line lg:block" />
            <li className="inline-flex items-center gap-2 lg:gap-3">
              <Logo src={payme} alt="Payme" className="h-[13px] lg:h-[17px]" />
              <Logo src={click} alt="Click" className="h-3 lg:h-[15px]" />
            </li>
            {returnDays ? (
              <>
                <li aria-hidden className="hidden h-[18px] w-px bg-line lg:block" />
                <li>{t.rich('trustReturn', { days: returnDays, b })}</li>
              </>
            ) : null}
          </ul>
        </div>
      </div>

      {hero ? (
        <BeforeAfter
          label={t('sliderLabel')}
          handleSize="responsive"
          className="order-3 h-[360px] rounded-[22px] bg-forest lg:min-h-[680px] lg:min-w-0 lg:flex-[1_1_620px] lg:rounded-xl"
          after={
            <Image
              src={hero.after.url}
              alt={hero.after.alt}
              fill
              priority
              sizes="(min-width: 1024px) 750px, 100vw"
              className="object-cover object-[48%_64%] lg:object-[55%_62%]"
            />
          }
          before={
            <Image
              src={hero.before.url}
              alt={hero.before.alt}
              fill
              priority
              sizes="(min-width: 1024px) 750px, 100vw"
              className="object-cover object-[48%_64%] lg:object-[55%_62%]"
            />
          }
        >
          <span className="pointer-events-none absolute top-3 left-3 rounded-pill bg-ink/72 px-3 py-1.5 text-xs font-semibold text-white lg:top-6 lg:left-6 lg:px-4 lg:py-[9px] lg:text-[13px]">
            {t('before')}
          </span>
          <span className="pointer-events-none absolute top-3 right-3 rounded-pill bg-white px-3 py-1.5 text-xs font-semibold lg:top-6 lg:right-6 lg:px-4 lg:py-[9px] lg:text-[13px]">
            <span className="lg:hidden">{t('afterShort')}</span>
            <span className="hidden lg:inline">{t('after')}</span>
          </span>
          <span className="pointer-events-none absolute bottom-[30px] left-6 hidden items-center gap-2 text-[13px] font-medium text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.4)] lg:inline-flex">
            <ChevronsLeftRight size={16} aria-hidden />
            {t('drag')}
          </span>
          {hero.product ? (
            <div className="absolute right-6 bottom-6 z-10 hidden w-80 items-center gap-3.5 rounded-[24px] bg-white/96 p-3 lg:flex">
              {hero.product.image ? (
                <Image
                  src={hero.product.image.url}
                  alt=""
                  width={64}
                  height={64}
                  sizes="64px"
                  className="size-16 rounded-2xl object-cover"
                />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium text-muted">{t('forThisResult')}</span>
                <Link
                  href={routes.product(hero.product.slug)}
                  className="text-[15px] font-semibold after:absolute after:inset-0 after:content-['']"
                >
                  {hero.product.name}
                </Link>
                <Price
                  soum={hero.product.priceFromSoum}
                  from={hero.product.hasPriceRange}
                  locale={locale}
                  className="text-sm font-semibold"
                />
              </span>
              {hero.product.inStock && hero.product.defaultVariantId ? (
                <AddToCartButton
                  variantId={hero.product.defaultVariantId}
                  priceSoum={hero.product.priceFromSoum}
                  productName={hero.product.name}
                  trackList="home_hero"
                  className="size-11"
                />
              ) : null}
            </div>
          ) : null}
        </BeforeAfter>
      ) : fallbackImage ? (
        <div className="relative order-3 h-[360px] overflow-hidden rounded-[22px] bg-forest lg:min-h-[680px] lg:min-w-0 lg:flex-[1_1_620px] lg:rounded-xl">
          <Image
            src={fallbackImage.url}
            alt={fallbackImage.alt}
            fill
            priority
            sizes="(min-width: 1024px) 750px, 100vw"
            className="object-cover"
          />
        </div>
      ) : null}
    </section>
  );
}
