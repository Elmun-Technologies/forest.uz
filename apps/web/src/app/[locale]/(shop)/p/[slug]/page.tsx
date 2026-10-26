import type { Locale, ProductDetailDto, ProductReviewsDto } from '@forest/contracts';
import { Price } from '@forest/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { formatRating } from '@/components/home/hero';
import { ClientMessages } from '@/components/client-messages';
import { JsonLd } from '@/components/json-ld';
import { CheckIcon } from '@/components/layout/icons';
import { PaintCalculator } from '@/components/product/calculator';
import { DeliveryRows } from '@/components/product/delivery-rows';
import { ProductGallery } from '@/components/product/gallery';
import {
  BuyBox,
  InStockAlternative,
  PurchaseProvider,
  SkuLabel,
  StickyBuyBar,
  VariantPicker,
} from '@/components/product/purchase';
import { MoreReviews } from '@/components/product/more-reviews';
import { ReviewCard } from '@/components/product/review-card';
import { Tabs } from '@/components/product/tabs';
import { Rating } from '@forest/ui';
import { ApiError, apiGet, apiGetOptional } from '@/lib/api';
import { notFoundWithRedirect } from '@/lib/not-found';
import { getSettings } from '@/lib/data';
import { expressZone, regionsZone } from '@/lib/delivery';
import { absoluteUrl, alternates, metaDescription } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

// Cached per request: metadata and page share one fetch (and one 404 report/redirect lookup).
const loadProduct = cache(async (slug: string, locale: Locale): Promise<ProductDetailDto> => {
  try {
    return await apiGet<ProductDetailDto>(`/catalog/products/${encodeURIComponent(slug)}`, locale, {
      tags: [`product:${slug}`],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404)
      return notFoundWithRedirect(`/${locale}${routes.product(slug)}`);
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await loadProduct(slug, locale);
  const t = await getTranslations({ locale, namespace: 'product' });
  const title = t('metaTitle', { name: p.name });
  const description = metaDescription(`${p.shortDesc} ${t('metaDescriptionTail')}`);
  return {
    title,
    description,
    alternates: alternates(locale, routes.product(p.slug)),
    openGraph: {
      title,
      description,
      type: 'website',
      images: p.images.slice(0, 1).map((i) => ({
        url: i.url,
        width: i.width ?? undefined,
        height: i.height ?? undefined,
        alt: i.alt,
      })),
    },
  };
}

const dryLabel = (t: (k: string, v: Record<string, number>) => string, minutes: number) =>
  minutes % 60 === 0
    ? t('specs.dryHours', { count: minutes / 60 })
    : t('specs.dryMinutes', { count: minutes });

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [p, settings, reviews] = await Promise.all([
    loadProduct(slug, locale),
    getSettings(locale),
    // Verified, approved reviews only; the section stays hidden until there is at least one.
    apiGetOptional<ProductReviewsDto>(
      `/catalog/products/${encodeURIComponent(slug)}/reviews`,
      locale,
      {
        revalidate: 60,
        tags: [`product:${slug}`],
      },
    ),
  ]);
  const t = await getTranslations('product');
  const tc = await getTranslations('common');
  const tcard = await getTranslations('card');
  const express = settings ? (expressZone(settings) ?? null) : null;
  const regions = settings ? (regionsZone(settings) ?? null) : null;
  const badge = p.discountPct
    ? tcard('discount', { pct: p.discountPct })
    : p.badges.includes('HIT')
      ? tcard('badges.HIT')
      : p.badges.includes('NEW')
        ? tcard('badges.NEW')
        : null;
  const paragraphs = p.description
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const [lede, ...rest] = paragraphs;
  const images = p.images.length > 0 ? p.images : p.image ? [p.image] : [];
  const inStock = p.variants.filter((v) => v.inStock);
  const prices = p.variants.map((v) => v.priceSoum);
  const url = absoluteUrl(locale, routes.product(p.slug));

  const specsList = p.specs.length ? (
    <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2 sm:gap-x-10">
      {p.specs.map((s) => (
        <div key={s.key} className="flex justify-between gap-4 border-b border-line py-3.5">
          <dt className="text-muted">{s.key}</dt>
          <dd className="text-right font-medium">{s.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
  const steps = p.howToApply.length ? (
    <ol className="flex flex-col gap-3">
      {p.howToApply.map((s, i) => (
        <li key={s} className="flex gap-3 leading-relaxed">
          <b className="tabular shrink-0 font-semibold">{String(i + 1).padStart(2, '0')}</b>
          <span className="text-ink-2">{s}</span>
        </li>
      ))}
    </ol>
  ) : null;
  const description = (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap gap-10">
        {lede ? (
          <p className="flex-[1_1_300px] text-[26px] leading-[1.35] tracking-[-0.015em]">{lede}</p>
        ) : null}
        {rest.length ? (
          <div className="flex flex-[1_1_300px] flex-col gap-3.5 text-[15px] leading-[1.7] text-muted">
            {rest.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        ) : null}
      </div>
      {specsList}
    </div>
  );
  const delivery = settings ? <DeliveryRows settings={settings} locale={locale} compact /> : null;

  const tiles = [
    p.coverageM2PerL
      ? {
          big: t('specs.coverage', { value: String(p.coverageM2PerL).replace('.', ',') }),
          small: t('specs.coverageHint'),
          smallM: t('specs.coverageHintShort'),
          tone: 'panel',
        }
      : null,
    p.dryTimeMinutes
      ? {
          big: dryLabel(t, p.dryTimeMinutes),
          small: t('specs.dryHint'),
          smallM: t('specs.dryHintShort'),
          tone: 'panel',
        }
      : null,
  ].filter((x): x is { big: string; small: string; smallM: string; tone: string } => x !== null);
  if (tiles.length)
    tiles.push({
      big: t('specs.eu'),
      small: t('specs.euHint'),
      smallM: t('specs.euHint'),
      tone: 'forest',
    });

  return (
    <ClientMessages namespaces={['product']}>
      <PurchaseProvider
        productId={p.id}
        name={p.name}
        image={images[0]?.url ?? null}
        variants={p.variants}
        defaultVariantId={p.defaultVariantId}
        coverage={p.coverageM2PerL}
        express={express}
      >
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: p.name,
            description: p.shortDesc,
            image: images.map((i) => i.url),
            sku: p.variants[0]?.sku,
            url,
            brand: { '@type': 'Brand', name: p.seller.name },
            offers:
              p.variants.length > 1
                ? {
                    '@type': 'AggregateOffer',
                    priceCurrency: 'UZS',
                    lowPrice: Math.min(...prices),
                    highPrice: Math.max(...prices),
                    offerCount: p.variants.length,
                    availability: inStock.length
                      ? 'https://schema.org/InStock'
                      : 'https://schema.org/OutOfStock',
                    url,
                  }
                : {
                    '@type': 'Offer',
                    priceCurrency: 'UZS',
                    price: p.variants[0]?.priceSoum ?? p.priceFromSoum,
                    availability: inStock.length
                      ? 'https://schema.org/InStock'
                      : 'https://schema.org/OutOfStock',
                    url,
                    seller: { '@type': 'Organization', name: p.seller.name },
                  },
            ...(p.rating
              ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: p.rating.average,
                    reviewCount: p.rating.count,
                  },
                }
              : {}),
          }}
        />
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: tc('home'),
                item: absoluteUrl(locale, '/'),
              },
              ...(p.categorySlug && p.categoryName
                ? [
                    {
                      '@type': 'ListItem',
                      position: 2,
                      name: p.categoryName,
                      item: absoluteUrl(locale, routes.category(p.categorySlug)),
                    },
                  ]
                : []),
              { '@type': 'ListItem', position: p.categorySlug ? 3 : 2, name: p.name, item: url },
            ],
          }}
        />

        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-3 pb-24 lg:gap-6 lg:px-6 lg:pt-2 lg:pb-16">
          <nav
            aria-label={tc('breadcrumb')}
            className="hidden px-2 text-[13px] text-muted lg:block"
          >
            <ol className="flex flex-wrap gap-1">
              <li>
                <Link href={routes.home} prefetch={false} className="hover:text-ink">
                  {tc('home')}
                </Link>{' '}
                /
              </li>
              {p.categorySlug && p.categoryName ? (
                <li>
                  <Link
                    href={routes.category(p.categorySlug)}
                    prefetch={false}
                    className="hover:text-ink"
                  >
                    {p.categoryName}
                  </Link>{' '}
                  /
                </li>
              ) : null}
              <li aria-current="page">{p.name}</li>
            </ol>
          </nav>

          <section className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-stretch lg:gap-4">
            <ProductGallery images={images} videoUrl={p.videoUrl} badge={badge} name={p.name} />
            <div className="flex min-w-0 flex-col gap-3.5 rounded-lg bg-panel p-5 lg:flex-[1_1_460px] lg:gap-6 lg:rounded-xl lg:p-10">
              <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-start">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-canvas py-[5px] pr-2.5 pl-[5px] text-xs font-semibold lg:gap-2 lg:py-1.5 lg:pr-3.5 lg:pl-1.5 lg:text-[13px]">
                  <span className="grid size-5 place-items-center rounded-pill bg-forest text-white lg:size-[26px]">
                    <CheckIcon size={12} strokeWidth={3} />
                  </span>
                  {p.seller.isOfficial ? (
                    <>
                      <span className="lg:hidden">
                        {t('officialShort', { seller: p.seller.name })}
                      </span>
                      <span className="hidden lg:inline">
                        {t('official', { seller: p.seller.name })}
                      </span>
                    </>
                  ) : (
                    t('sellerLine', { seller: p.seller.name })
                  )}
                </span>
                <SkuLabel />
                {p.rating ? (
                  <a href="#sharhlar" className="text-xs font-semibold lg:hidden">
                    ★ {formatRating(p.rating.average)} · {p.rating.count}
                  </a>
                ) : null}
              </div>
              <h1 className="text-[30px] leading-[1.05] font-medium tracking-[-0.035em] lg:text-5xl lg:leading-[1.02] lg:tracking-[-0.04em]">
                {p.name}
              </h1>
              {p.rating ? (
                <p className="hidden flex-wrap items-center gap-3 text-sm lg:flex">
                  <Rating
                    value={p.rating.average}
                    label={t('ratingLabel', { value: formatRating(p.rating.average) })}
                    size={16}
                  />
                  <b className="font-semibold">{formatRating(p.rating.average)}</b>
                  <a href="#sharhlar" className="text-muted underline">
                    {t('ratingCount', { count: p.rating.count })}
                  </a>
                </p>
              ) : null}
              <p className="text-sm leading-[1.55] text-muted lg:text-base lg:leading-[1.65]">
                {p.shortDesc}
              </p>
              <VariantPicker />
              <BuyBox />
              <InStockAlternative alternatives={p.alternatives} />
              {settings ? (
                <div className="hidden lg:block">
                  <DeliveryRows settings={settings} locale={locale} />
                </div>
              ) : null}
            </div>
          </section>

          {tiles.length > 1 ? (
            <ul className="grid grid-cols-2 gap-2 lg:mt-6 lg:flex lg:flex-wrap lg:gap-4">
              {tiles.map((tile) => (
                <li
                  key={tile.big}
                  className={
                    tile.tone === 'forest'
                      ? 'flex flex-col justify-between gap-[18px] rounded-[22px] bg-forest p-4 text-white odd:last:col-span-2 lg:min-h-[220px] lg:flex-[1_1_220px] lg:gap-12 lg:rounded-[32px] lg:p-8'
                      : 'flex flex-col justify-between gap-[18px] rounded-[22px] bg-panel p-4 lg:min-h-[220px] lg:flex-[1_1_220px] lg:gap-12 lg:rounded-[32px] lg:p-8'
                  }
                >
                  <b className="text-2xl font-semibold tracking-[-0.03em] lg:text-[52px] lg:leading-none lg:tracking-[-0.04em]">
                    {tile.big}
                  </b>
                  <span
                    className={
                      tile.tone === 'forest'
                        ? 'text-xs text-sage italic lg:text-sm'
                        : 'text-xs text-muted italic lg:text-sm'
                    }
                  >
                    <span className="lg:hidden">{tile.smallM}</span>
                    <span className="hidden lg:inline">{tile.small}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <section className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:gap-4">
            <div className="hidden min-w-0 flex-[3_1_600px] rounded-xl bg-panel p-12 lg:block">
              <Tabs
                label={t('tabs.label')}
                tabs={[
                  { id: 'desc', title: t('tabs.description'), panel: description },
                  ...(specsList ? [{ id: 'specs', title: t('tabs.specs'), panel: specsList }] : []),
                  ...(steps ? [{ id: 'apply', title: t('tabs.apply'), panel: steps }] : []),
                  ...(delivery && express && regions
                    ? [
                        {
                          id: 'delivery',
                          title: t('tabs.delivery', {
                            tashkent: express.promiseHours,
                            regions: regions.promiseHours,
                          }),
                          panel: delivery,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            {p.coverageM2PerL && p.variants.some((v) => v.volumeMl) ? (
              <PaintCalculator coverage={p.coverageM2PerL} variants={p.variants} />
            ) : null}
            <div className="order-last rounded-lg bg-panel px-[18px] py-1.5 lg:hidden">
              {[
                steps ? { title: t('tabs.applyMobile'), body: steps } : null,
                specsList ? { title: t('tabs.specs'), body: specsList } : null,
                {
                  title: t('tabs.description'),
                  body: (
                    <div className="flex flex-col gap-3 text-sm leading-[1.55] text-muted">
                      {paragraphs.map((x) => (
                        <p key={x}>{x}</p>
                      ))}
                    </div>
                  ),
                },
                delivery ? { title: t('tabs.deliveryMobile'), body: delivery } : null,
              ]
                .filter((x) => x !== null)
                .map((x, i, arr) => (
                  <details
                    key={x.title}
                    open={i === 0}
                    className={i < arr.length - 1 ? 'border-b border-line py-3.5' : 'py-3.5'}
                  >
                    <summary className="cursor-pointer text-[15px] font-semibold">
                      {x.title}
                    </summary>
                    <div className="mt-2 text-sm">{x.body}</div>
                  </details>
                ))}
            </div>
          </section>

          <section className="hidden flex-wrap gap-4 lg:flex">
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-6 rounded-xl bg-ink p-10 text-white">
              <span className="text-[13px] text-on-dark-subtle">{t('seller.overline')}</span>
              <div className="flex items-center gap-4">
                <span className="grid size-[72px] shrink-0 place-items-center rounded-pill bg-forest text-2xl font-semibold">
                  {p.seller.name.slice(0, 1)}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-[22px] font-semibold">{p.seller.name}</span>
                  {p.seller.isOfficial ? (
                    <span className="text-sm text-on-dark-muted">{t('seller.official')}</span>
                  ) : null}
                </span>
              </div>
              <Link
                href={`${routes.catalog}?brand=${p.seller.slug}`}
                className="self-start rounded-pill bg-white px-[22px] py-3 text-sm font-semibold text-ink"
              >
                {t('seller.all')}
              </Link>
            </div>
            {p.howToApply.length ? (
              <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-4 rounded-xl bg-panel p-10">
                <h2 className="text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">
                  {t('steps')}
                </h2>
                <ol className="flex flex-wrap gap-4">
                  {p.howToApply.map((s, i) => (
                    <li
                      key={s}
                      className="flex flex-[1_1_200px] flex-col gap-3.5 rounded-[24px] bg-canvas p-6"
                    >
                      <b className="text-lg">{String(i + 1).padStart(2, '0')}</b>
                      <span className="text-sm leading-[1.55] text-muted">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          {reviews && reviews.total > 0 ? (
            <section
              id="sharhlar"
              aria-labelledby="reviews-title"
              className="flex scroll-mt-6 flex-col gap-3 rounded-lg bg-panel p-5 lg:gap-7 lg:rounded-xl lg:p-12"
            >
              <div className="flex flex-wrap items-end justify-between gap-4 lg:border-b lg:border-line lg:pb-6">
                <h2
                  id="reviews-title"
                  className="text-xl font-semibold lg:text-[56px] lg:leading-none lg:font-medium lg:tracking-[-0.045em]"
                >
                  {t('reviews.title')}
                </h2>
                {p.rating ? (
                  <span className="flex items-center gap-3 text-sm text-muted">
                    <Rating
                      value={p.rating.average}
                      label={t('ratingLabel', { value: formatRating(p.rating.average) })}
                    />
                    {formatRating(p.rating.average)} ·{' '}
                    {t('reviews.summary', { count: p.rating.count })}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2.5 lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] lg:gap-4">
                {reviews.items.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    labels={{
                      verified: t('reviews.verified'),
                      reply: t('reviews.reply'),
                      rating: t('ratingLabel', { value: formatRating(r.rating) }),
                      photo: t('reviews.photo', { author: r.author }),
                    }}
                  />
                ))}
                {reviews.pageCount > 1 ? (
                  <ClientMessages namespaces={['product']}>
                    <MoreReviews slug={p.slug} pageCount={reviews.pageCount} />
                  </ClientMessages>
                ) : null}
              </div>
            </section>
          ) : null}

          {p.related.length ? (
            <section aria-labelledby="together" className="flex flex-col gap-2.5 lg:gap-6 lg:pt-6">
              <h2
                id="together"
                className="px-1.5 text-xl font-semibold lg:px-0 lg:text-5xl lg:leading-none lg:font-medium lg:tracking-[-0.04em]"
              >
                {t('together')}
              </h2>
              <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] lg:gap-4 lg:overflow-visible lg:px-0">
                {p.related.map((r) => (
                  <li
                    key={r.id}
                    className="relative flex w-[150px] shrink-0 flex-col gap-2 rounded-[20px] bg-panel px-1.5 pt-1.5 pb-3 lg:w-auto lg:flex-row lg:items-center lg:gap-4 lg:rounded-[28px] lg:py-2.5 lg:pr-5 lg:pl-2.5"
                  >
                    {r.image ? (
                      <span className="relative block h-[110px] w-full shrink-0 overflow-hidden rounded-[14px] lg:size-24 lg:rounded-[20px]">
                        <Image
                          src={r.image.url}
                          alt=""
                          fill
                          sizes="(min-width: 1024px) 96px, 150px"
                          className="object-cover"
                        />
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-1 px-1 lg:px-0">
                      <Link
                        href={routes.product(r.slug)}
                        className="text-[13px] font-semibold after:absolute after:inset-0 lg:text-[15px]"
                      >
                        {r.name}
                      </Link>
                      <Price
                        soum={r.priceFromSoum}
                        from={r.hasPriceRange}
                        locale={locale}
                        className="text-[13px] font-bold lg:text-[15px]"
                      />
                    </span>
                    {r.inStock && r.defaultVariantId ? (
                      <AddToCartButton
                        variantId={r.defaultVariantId}
                        priceSoum={r.priceFromSoum}
                        productName={r.name}
                        look="round-sm"
                        trackList="product_together"
                        className="hidden size-10 lg:inline-flex"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <StickyBuyBar />
      </PurchaseProvider>
    </ClientMessages>
  );
}
