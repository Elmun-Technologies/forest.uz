import type { Locale, SearchResultDto } from '@forest/contracts';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ProductCard } from '@/components/product/product-card';
import { apiGetOptional } from '@/lib/api';
import { alternates } from '@/lib/seo';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'search' });
  // Search result pages are never indexed (thin/duplicate content).
  return {
    title: t('title'),
    alternates: alternates(locale, routes.search),
    robots: { index: false, follow: true },
  };
}

/** `/{locale}/qidiruv?q=` — target of the header search box (GET /v1/catalog/search). */
export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? '';
  const t = await getTranslations('search');
  const result = q
    ? await apiGetOptional<SearchResultDto>(`/catalog/search?q=${encodeURIComponent(q)}`, locale, {
        revalidate: 60,
      })
    : null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-3 pb-16 lg:px-6 lg:pt-2">
      <section className="flex flex-col gap-6 rounded-lg bg-panel p-5 lg:rounded-xl lg:px-12 lg:py-10">
        <h1 className="text-[36px] leading-none font-medium tracking-[-0.045em] lg:text-h1">
          {t('title')}
        </h1>
        <form
          role="search"
          action={`/${locale}${routes.search}`}
          className="flex max-w-[640px] gap-2"
        >
          <label htmlFor="search-q" className="sr-only">
            {t('placeholder')}
          </label>
          <span className="flex h-[52px] flex-1 items-center gap-2 rounded-pill border border-line px-4 focus-within:border-ink">
            <Search size={18} className="text-muted" aria-hidden />
            <input
              id="search-q"
              name="q"
              type="search"
              defaultValue={q}
              enterKeyHint="search"
              placeholder={t('placeholder')}
              className="min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none"
            />
          </span>
          <button
            type="submit"
            className="h-[52px] rounded-pill bg-ink px-6 text-sm font-semibold text-white"
          >
            {t('submit')}
          </button>
        </form>
        {!q ? <p className="text-muted">{t('prompt')}</p> : null}
        {q && !result ? (
          <p role="status" className="text-muted">
            {t('unavailable')}{' '}
            <Link href={routes.catalog} className="font-semibold text-ink underline">
              {t('toCatalog')}
            </Link>
          </p>
        ) : null}
        {result ? (
          <p
            role="status"
            className="text-muted"
            data-track="search"
            data-results={result.products.length}
          >
            {result.products.length
              ? t('results', { query: result.query, count: result.products.length })
              : t('empty', { query: result.query })}
          </p>
        ) : null}
        {result && result.products.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{t('emptyHint')}</p>
            {result.suggestions.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">{t('suggestions')}</span>
                {result.suggestions.map((s) => (
                  <Link
                    key={s}
                    href={`${routes.search}?q=${encodeURIComponent(s)}`}
                    className="rounded-pill bg-canvas px-4 py-2 text-[13px] font-medium hover:bg-sage"
                  >
                    {s}
                  </Link>
                ))}
              </div>
            ) : null}
            <Link
              href={routes.catalog}
              className="self-start rounded-pill bg-ink px-5 py-3 text-sm font-semibold text-white"
            >
              {t('toCatalog')}
            </Link>
          </div>
        ) : null}
        {result && result.categories.length ? (
          <nav aria-label={t('categories')} className="flex flex-wrap gap-2">
            {result.categories.map((c) => (
              <Link
                key={c.slug}
                href={routes.category(c.slug)}
                className="rounded-pill bg-canvas px-4 py-2 text-[13px] font-semibold hover:bg-sage"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </section>
      {result && result.products.length ? (
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] lg:gap-4">
          {result.products.map((p, i) => (
            <li key={p.id}>
              <ProductCard product={p} locale={locale} priority={i < 2} list="search" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
