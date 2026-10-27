import { type ArticleCategory, isArticleCategory, type Locale } from '@forest/contracts';
import { cn } from '@forest/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArticleCard } from '@/components/content/article-card';
import { Gallery, HowToAndFaq, renderableFaq } from '@/components/home/sections';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { getArticles } from '@/lib/cms';
import { getHomeContent } from '@/lib/data';
import { alternates, metaDescription } from '@/lib/seo';
import { getSeoOverride, withSeoOverride } from '@/lib/seo-meta';

// Reads ?category=&page= (the [locale] layout would otherwise make it static).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function query(sp: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const c = one(sp.category);
  const p = Number(one(sp.page) ?? '1');
  return {
    category: isArticleCategory(c) ? c : undefined,
    page: Number.isInteger(p) && p >= 1 && p <= 1000 ? p : 1,
  };
}

const href = (category: ArticleCategory | undefined, page = 1) => {
  const sp = new URLSearchParams();
  if (category) sp.set('category', category);
  if (page > 1) sp.set('page', String(page));
  const s = sp.toString();
  return `${routes.inspiration}${s ? `?${s}` : ''}`;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const q = query(await searchParams);
  const [t, override] = await Promise.all([
    getTranslations({ locale, namespace: 'ilhom' }),
    getSeoOverride(locale, routes.inspiration),
  ]);
  const base: Metadata = {
    title: t('metaTitle'),
    description: metaDescription(t('metaDescription')),
    alternates: alternates(
      locale,
      q.page > 1 && !q.category ? href(undefined, q.page) : routes.inspiration,
    ),
    // Category filters and deep pages are navigation, not landing pages (docs/10).
    ...(q.category ? { robots: { index: false, follow: true } } : {}),
  };
  return withSeoOverride(base, override);
}

/** Ilhom index (design Ilhom): hero + chips, featured article, before/after, grid, FAQ. */
export default async function IlhomPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const q = query(await searchParams);
  const [t, list, home] = await Promise.all([
    getTranslations('ilhom'),
    getArticles(locale, q.category, q.page),
    getHomeContent(locale),
  ]);
  const unfiltered = !q.category && q.page === 1;
  const featured = unfiltered ? list.items.find((a) => a.cover) : undefined;
  const items = list.items.filter((a) => a !== featured);
  const faq = unfiltered ? renderableFaq(home?.faq ?? []) : [];
  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-9 items-center rounded-pill px-4 text-[13px] font-semibold transition-colors',
      active ? 'bg-ink text-white' : 'bg-off text-ink hover:bg-sage-50',
    );

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-6 lg:px-6 lg:pt-2">
      <section className="flex flex-col gap-2.5 lg:flex-row lg:gap-4">
        <div
          className={cn(
            'flex flex-col justify-between gap-6 rounded-lg bg-panel p-6 lg:flex-[1_1_0] lg:rounded-xl lg:p-14',
            featured && 'lg:min-h-[520px]',
          )}
        >
          <h1 className="text-[56px] leading-[0.9] font-medium tracking-[-0.06em] lg:text-[104px]">
            {t('titleTop')}
            <br />
            {t('titleBottom')}
          </h1>
          <div className="flex flex-col gap-5">
            <p className="max-w-[420px] text-[15px] leading-relaxed text-muted">{t('lead')}</p>
            {list.categories.length ? (
              <nav aria-label={t('breadcrumb')} className="flex flex-wrap gap-2">
                <Link
                  href={href(undefined)}
                  className={chip(!q.category)}
                  aria-current={!q.category ? 'page' : undefined}
                >
                  {t('all')}
                </Link>
                {list.categories.map((c) => (
                  <Link
                    key={c}
                    href={href(c)}
                    className={chip(q.category === c)}
                    aria-current={q.category === c ? 'page' : undefined}
                  >
                    {t(`cat_${c}`)}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
        {featured?.cover ? (
          <Link
            href={`${routes.inspiration}/${featured.slug}`}
            className="relative min-h-[360px] overflow-hidden rounded-lg text-white lg:min-h-[520px] lg:flex-[1_1_0] lg:rounded-xl"
          >
            <Image
              src={featured.cover.url}
              alt={featured.cover.alt}
              fill
              priority
              sizes="(min-width: 1024px) 700px, 100vw"
              className="object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-ink/80 to-transparent to-60%"
            />
            <span className="absolute top-5 left-5 rounded-pill bg-white px-3 py-1.5 text-xs font-semibold text-ink">
              {t('featured')}
            </span>
            <span className="absolute inset-x-6 bottom-6 flex flex-col gap-2 lg:inset-x-9 lg:bottom-9">
              <span className="text-[28px] leading-[1.05] font-medium tracking-[-0.035em] lg:text-[40px]">
                {featured.title}
              </span>
              {featured.readingMinutes ? (
                <span className="text-sm text-[#E1E7DA]">
                  {t('readingTime', { minutes: featured.readingMinutes })}
                </span>
              ) : null}
            </span>
          </Link>
        ) : null}
      </section>

      {unfiltered ? <Gallery items={home?.gallery ?? []} /> : null}

      <section aria-labelledby="ilhom-list" className="flex flex-col gap-3 lg:gap-6 lg:pt-6">
        <h2
          id="ilhom-list"
          className="px-1.5 text-[28px] leading-none font-medium tracking-[-0.035em] lg:px-0 lg:text-[56px]"
        >
          {q.category ? t(`cat_${q.category}`) : t('articles')}
        </h2>
        {list.total === 0 ? (
          <p className="rounded-lg bg-panel p-8 text-center text-muted" data-testid="ilhom-empty">
            {q.category ? t('emptyCategory') : t('empty')}{' '}
            <Link href={routes.catalog} className="font-semibold text-forest underline">
              {t('toCatalog')}
            </Link>
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            {items.map((a) => (
              <li key={a.slug}>
                <ArticleCard a={a} />
              </li>
            ))}
          </ul>
        )}
        {list.pages > 1 ? (
          <nav aria-label={t('pagination')} className="flex items-center justify-center gap-2 pt-2">
            {q.page > 1 ? (
              <Link href={href(q.category, q.page - 1)} className={chip(false)} rel="prev">
                {t('prev')}
              </Link>
            ) : null}
            <span className="text-[13px] text-muted">{t('page', { page: q.page })}</span>
            {q.page < list.pages ? (
              <Link href={href(q.category, q.page + 1)} className={chip(false)} rel="next">
                {t('next')}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      {faq.length ? <HowToAndFaq howTo={null} faq={faq} /> : null}
    </div>
  );
}
