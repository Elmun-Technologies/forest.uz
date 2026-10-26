import 'server-only';
import type { Locale, ProductCardDto, ProductListDto } from '@forest/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { CatalogView } from '@/components/catalog/catalog-view';
import { routes } from '@/config/site';
import { apiGet, apiGetOptional } from './api';
import { catalogApiQuery, catalogSearch, isRefined, parseCatalogParams } from './catalog-params';
import { getCategories, getSettings } from './data';
import { alternates, metaDescription } from './seo';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Shared metadata for `/katalog` and `/katalog/[category]` (docs/10 filter/pagination rules). */
export async function catalogMetadata(
  locale: Locale,
  slug: string | null,
  searchParams: SearchParams,
): Promise<Metadata> {
  const filters = parseCatalogParams(await searchParams);
  const t = await getTranslations({ locale, namespace: 'catalog' });
  const categories = await getCategories(locale);
  const category = slug ? categories.find((c) => c.slug === slug) : null;
  if (slug && !category) return {};
  const base = slug ? routes.category(slug) : routes.catalog;
  const refined = isRefined(filters);
  const title = category ? t('categoryMetaTitle', { name: category.name }) : t('metaTitle');
  const description = category
    ? metaDescription(
        category.seoText ??
          t('categoryMetaDescription', { name: category.name, count: category.productCount }),
      )
    : t('metaDescription');
  return {
    title,
    description,
    // Filters/sort → noindex,follow + canonical to the base category; `?page=n` is self-canonical.
    alternates: alternates(
      locale,
      refined ? base : `${base}${catalogSearch({ ...filters, sort: 'popular' })}`,
    ),
    robots: refined ? { index: false, follow: true } : undefined,
    openGraph: { title, description },
  };
}

export async function CatalogPage({
  locale,
  slug,
  searchParams,
}: {
  locale: Locale;
  slug: string | null;
  searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  const filters = parseCatalogParams(await searchParams);
  const [categories, settings] = await Promise.all([getCategories(locale), getSettings(locale)]);
  const category = slug ? (categories.find((c) => c.slug === slug) ?? null) : null;
  if (slug && !category) notFound();

  const [list, promoList] = await Promise.all([
    apiGet<ProductListDto>(
      `/catalog/products${catalogApiQuery(filters, slug ?? undefined)}`,
      locale,
    ),
    filters.page === 1
      ? apiGetOptional<ProductListDto>('/catalog/products?onSale=true&limit=12', locale)
      : Promise.resolve(null),
  ]);
  const promo: ProductCardDto | null =
    promoList?.items.find((p) => p.type === 'BUNDLE' && p.discountPct && p.inStock) ?? null;

  return (
    <ClientMessages namespaces={['catalog']}>
      <CatalogView
        locale={locale}
        categories={categories}
        category={category}
        filters={filters}
        list={list}
        promo={promo}
        telegramBot={settings?.store.telegramBot ?? null}
      />
    </ClientMessages>
  );
}
