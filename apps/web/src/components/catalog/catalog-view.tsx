import type { CategoryDto, ProductCardDto, ProductListDto } from '@forest/contracts';
import { formatAmount, soumToTiyin } from '@forest/contracts/core';
import { cn, Price } from '@forest/ui';
import { ArrowRight, ArrowUpRight, LayoutGrid, Search, X } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes, telegramUrl } from '@/config/site';
import { JsonLd } from '@/components/json-ld';
import { ProductCard } from '@/components/product/product-card';
import {
  type CatalogFilters,
  catalogApiQuery,
  catalogSearch,
  isRefined,
  volumeLabel,
} from '@/lib/catalog-params';
import { absoluteUrl } from '@/lib/seo';
import { FilterPanel } from './filter-panel';
import { ProductGrid } from './load-more';
import { MobileFilters } from './mobile-filters';
import { SortSelect } from './sort-select';

export interface CatalogViewProps {
  locale: 'uz' | 'ru';
  categories: CategoryDto[];
  category: CategoryDto | null;
  filters: CatalogFilters;
  list: ProductListDto;
  promo: ProductCardDto | null;
  telegramBot: string | null;
}

/** Catalog (Katalog / Mobil-Katalog boards): categories, filters, grid, pagination, SEO text. */
export async function CatalogView({
  locale,
  categories,
  category,
  filters,
  list,
  promo,
  telegramBot,
}: CatalogViewProps) {
  const t = await getTranslations('catalog');
  const tc = await getTranslations('common');
  const base = category ? routes.category(category.slug) : routes.catalog;
  const allCount = categories.reduce((a, c) => a + c.productCount, 0);
  const title = category?.name ?? t('title');

  const pageHref: Record<number, string> = {};
  for (let n = 1; n <= list.pages; n++)
    pageHref[n] = `${base}${catalogSearch({ ...filters, page: n })}`;

  const chips = activeChips(filters, list, (k) => t(k as never));
  const items = list.items;
  // Promo kit card sits after the 5th card on page 1 (design), unless it's filtered out anyway.
  const promoAt =
    promo && filters.page === 1 && !isRefined(filters) ? Math.min(5, items.length) : -1;

  const capsules = [
    { slug: null, name: t('all'), count: allCount, image: null, href: routes.catalog },
    ...categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      count: c.productCount,
      image: c.image,
      href: routes.category(c.slug),
    })),
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-3 pb-16 lg:gap-6 lg:px-6 lg:pt-2">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: tc('home'), item: absoluteUrl(locale, '/') },
            {
              '@type': 'ListItem',
              position: 2,
              name: t('title'),
              item: absoluteUrl(locale, routes.catalog),
            },
            ...(category
              ? [
                  {
                    '@type': 'ListItem',
                    position: 3,
                    name: category.name,
                    item: absoluteUrl(locale, base),
                  },
                ]
              : []),
          ],
        }}
      />

      {/* Title + categories (desktop panel) */}
      <section className="flex flex-col gap-9 lg:rounded-xl lg:bg-panel lg:px-12 lg:pt-10 lg:pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-4">
            <nav aria-label={tc('breadcrumb')} className="hidden text-[13px] text-muted lg:block">
              <ol className="flex flex-wrap gap-1">
                <li>
                  <Link href={routes.home} className="hover:text-ink">
                    {tc('home')}
                  </Link>{' '}
                  /
                </li>
                {category ? (
                  <li>
                    <Link href={routes.catalog} className="hover:text-ink">
                      {t('title')}
                    </Link>{' '}
                    /
                  </li>
                ) : null}
                <li aria-current="page">{title}</li>
              </ol>
            </nav>
            <h1 className="sr-only lg:not-sr-only lg:text-display lg:font-medium">{title}</h1>
          </div>
          <span className="hidden rounded-pill border border-line px-[18px] py-2.5 text-sm text-muted lg:inline">
            {t('count', { count: list.total })}
          </span>
        </div>
        <nav aria-label={t('categories')} className="hidden lg:block">
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {capsules.map((c) => {
              const on = (category?.slug ?? null) === c.slug;
              return (
                <li key={c.slug ?? 'all'}>
                  <Link
                    href={c.href}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-4 rounded-pill py-2.5 pr-6 pl-2.5 transition-colors',
                      on ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage',
                    )}
                  >
                    {c.image ? (
                      <Image
                        src={c.image.url}
                        alt=""
                        width={72}
                        height={72}
                        sizes="72px"
                        className="size-[72px] shrink-0 rounded-pill object-cover"
                      />
                    ) : (
                      <span
                        className={cn(
                          'grid size-[72px] shrink-0 place-items-center rounded-pill',
                          on ? 'bg-dark-3' : 'bg-sage',
                        )}
                      >
                        <LayoutGrid size={26} strokeWidth={1.6} aria-hidden />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[17px] font-semibold">{c.name}</span>
                      <span className={cn('text-[13px]', on ? 'text-on-dark-muted' : 'text-muted')}>
                        {t('categoryCount', { count: c.count })}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </section>

      {/* Mobile: search + category chips + quiz banner */}
      <div className="flex flex-col gap-3 lg:hidden">
        <form
          role="search"
          action={`/${locale}${routes.search}`}
          className="flex h-11 items-center gap-2 rounded-pill bg-panel px-3.5"
        >
          <Search size={16} strokeWidth={2} className="text-muted" aria-hidden />
          <label htmlFor="cat-search" className="sr-only">
            {t('searchPlaceholder')}
          </label>
          <input
            id="cat-search"
            name="q"
            type="search"
            enterKeyHint="search"
            placeholder={t('searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-subtle focus:outline-none"
          />
        </form>
        <nav
          aria-label={t('categories')}
          className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none]"
        >
          <ul className="flex gap-1.5">
            {capsules.map((c) => {
              const on = (category?.slug ?? null) === c.slug;
              return (
                <li key={c.slug ?? 'all'} className="shrink-0">
                  <Link
                    href={c.href}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'block rounded-pill px-3.5 py-2.5 text-[13px] font-semibold whitespace-nowrap',
                      on ? 'bg-ink text-white' : 'bg-panel',
                    )}
                  >
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link
          href="/#tanlash"
          className="flex items-center gap-3 rounded-[22px] bg-forest px-4 py-3.5 text-white"
        >
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-pill bg-sage font-bold text-ink"
          >
            ?
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <b className="text-sm">{t('quizTitle')}</b>
            <span className="text-xs text-[#C9D3BD]">{t('quizMeta')}</span>
          </span>
          <ArrowRight size={18} aria-hidden />
        </Link>
      </div>

      <section className="flex flex-wrap items-start gap-4" aria-label={title}>
        <aside
          aria-label={t('filters')}
          className="hidden max-w-[320px] flex-[1_1_280px] flex-col gap-7 rounded-[32px] bg-panel p-7 lg:flex"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t('filters')}</h2>
            {isRefined({ ...filters, sort: 'popular' }) ? (
              <Link
                href={base}
                scroll={false}
                className="text-[13px] text-muted underline hover:text-ink"
              >
                {t('clear')}
              </Link>
            ) : null}
          </div>
          <FilterPanel filters={filters} facets={list.facets} idPrefix="d" />
        </aside>

        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-3 lg:gap-4">
          <div className="flex items-center justify-between gap-2.5 lg:hidden">
            <span className="text-[13px] text-muted">{t('count', { count: list.total })}</span>
            <span className="flex gap-1.5">
              <MobileFilters filters={filters} facets={list.facets} total={list.total} />
              <SortSelect filters={filters} compact />
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {chips.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('filters')}>
                {chips.map((c) => (
                  <li key={c.key}>
                    <Link
                      href={`${base}${catalogSearch({ ...filters, ...c.remove, page: 1 })}`}
                      scroll={false}
                      rel="nofollow"
                      aria-label={t('removeFilter', { label: c.label })}
                      className="inline-flex items-center gap-2 rounded-pill bg-ink py-[9px] pr-3.5 pl-4 text-[13px] font-medium text-white"
                    >
                      {c.label}
                      <X size={12} strokeWidth={2.4} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <span />
            )}
            <div className="hidden lg:block">
              <SortSelect filters={filters} />
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-[32px] bg-panel p-8">
              <h2 className="text-h3 font-medium">{t('empty')}</h2>
              <p className="text-muted">{t('emptyHint')}</p>
              <Link
                href={base}
                className="rounded-pill bg-ink px-5 py-3 text-sm font-semibold text-white"
              >
                {t('resetAll')}
              </Link>
            </div>
          ) : (
            <ProductGrid
              page={filters.page}
              pages={list.pages}
              pageHref={pageHref}
              apiQuery={catalogApiQuery(filters, category?.slug).replace(/&?page=\d+/, '')}
            >
              {items.flatMap((p, i) => {
                const card = (
                  <li key={p.id}>
                    <ProductCard product={p} locale={locale} priority={i < 2} list="catalog" />
                  </li>
                );
                return i === promoAt && promo
                  ? [<PromoCard key="promo" product={promo} locale={locale} />, card]
                  : [card];
              })}
              {promoAt === items.length && promo ? (
                <PromoCard key="promo" product={promo} locale={locale} />
              ) : null}
            </ProductGrid>
          )}
        </div>
      </section>

      <section className="flex flex-wrap gap-4">
        {category?.seoText || !category ? (
          <div className="flex flex-[2_1_560px] flex-col gap-3 rounded-[32px] bg-panel px-6 py-7 lg:px-10 lg:py-9">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] lg:text-[28px]">
              {category ? category.name : t('seoTitle')}
            </h2>
            <p className="max-w-[760px] leading-[1.7] text-muted">
              {category?.seoText ?? t('seoText')}
            </p>
          </div>
        ) : null}
        {telegramBot ? (
          <a
            href={telegramUrl(telegramBot, 'catalog_advice')}
            data-track="telegram_click"
            className="flex flex-[1_1_320px] items-center justify-between gap-4 rounded-[32px] bg-forest px-6 py-7 text-white lg:px-10 lg:py-9"
          >
            <span className="text-[22px] font-semibold tracking-[-0.02em]">{t('advice')}</span>
            <span className="grid size-14 shrink-0 place-items-center rounded-pill bg-white text-ink">
              <ArrowUpRight size={22} strokeWidth={1.8} aria-hidden />
            </span>
          </a>
        ) : null}
      </section>
    </div>
  );
}

function PromoCard({ product: p, locale }: { product: ProductCardDto; locale: 'uz' | 'ru' }) {
  return (
    <li className="hidden lg:block">
      <PromoCardInner product={p} locale={locale} />
    </li>
  );
}

async function PromoCardInner({
  product: p,
  locale,
}: {
  product: ProductCardDto;
  locale: 'uz' | 'ru';
}) {
  const t = await getTranslations('catalog');
  return (
    <Link
      href={routes.product(p.slug)}
      data-track="catalog_promo"
      className="relative flex h-full min-h-[260px] flex-col justify-between overflow-hidden rounded-[22px] bg-ink p-6 text-white lg:min-h-[420px] lg:rounded-[32px] lg:p-8"
    >
      {p.image ? (
        <Image
          src={p.image.url}
          alt=""
          fill
          sizes="(min-width: 1024px) 270px, 100vw"
          className="object-cover opacity-35"
        />
      ) : null}
      {p.discountPct ? (
        <span className="relative self-start rounded-pill bg-sage px-3.5 py-2 text-[13px] font-semibold text-ink">
          {t('promoBadge', { pct: p.discountPct })}
        </span>
      ) : (
        <span />
      )}
      <span className="relative flex flex-col gap-3.5">
        <span className="text-[28px] leading-[1.05] font-medium tracking-[-0.03em] lg:text-[34px]">
          {p.name}
        </span>
        <span className="text-sm text-on-dark-muted">{p.subtitle}</span>
        <span className="self-start rounded-pill bg-white px-5 py-3 text-sm font-semibold text-ink">
          <Price soum={p.priceFromSoum} from={p.hasPriceRange} locale={locale} />
        </span>
      </span>
    </Link>
  );
}

interface Chip {
  key: string;
  label: string;
  remove: Partial<CatalogFilters>;
}

function activeChips(f: CatalogFilters, list: ProductListDto, t: (k: string) => string): Chip[] {
  const chips: Chip[] = [];
  for (const s of f.surface)
    chips.push({
      key: `s-${s}`,
      label: t(`surfaces.${s}`),
      remove: { surface: f.surface.filter((x) => x !== s) },
    });
  for (const c of f.color) {
    const facet = list.facets.colors.find((x) => x.hex.replace('#', '').toLowerCase() === c);
    chips.push({
      key: `c-${c}`,
      label: facet?.label ?? `#${c.toUpperCase()}`,
      remove: { color: f.color.filter((x) => x !== c) },
    });
  }
  for (const v of f.volume)
    chips.push({
      key: `v-${v}`,
      label: volumeLabel(Number(v)),
      remove: { volume: f.volume.filter((x) => x !== v) },
    });
  if (f.priceMin !== undefined || f.priceMax !== undefined) {
    const lo = formatAmount(soumToTiyin(f.priceMin ?? list.facets.price.minSoum));
    const hi = formatAmount(soumToTiyin(f.priceMax ?? list.facets.price.maxSoum));
    chips.push({
      key: 'price',
      label: `${lo} – ${hi}`,
      remove: { priceMin: undefined, priceMax: undefined },
    });
  }
  for (const b of f.brand) {
    const facet = list.facets.brands.find((x) => x.slug === b);
    chips.push({
      key: `b-${b}`,
      label: facet?.name ?? b,
      remove: { brand: f.brand.filter((x) => x !== b) },
    });
  }
  if (f.onSale) chips.push({ key: 'sale', label: t('onSale'), remove: { onSale: false } });
  return chips;
}
