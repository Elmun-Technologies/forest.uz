import type { Locale } from '@forest/contracts';
import { formatTashkentDate } from '@forest/contracts/core';
import { Price } from '@forest/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArticleBlocks } from '@/components/content/article-blocks';
import { JsonLd } from '@/components/json-ld';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { getArticle } from '@/lib/cms';
import { absoluteUrl, metaDescription } from '@/lib/seo';
import { getSeoOverride, withSeoOverride } from '@/lib/seo-meta';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const path = `${routes.inspiration}/${slug}`;
  const [a, override] = await Promise.all([getArticle(locale, slug), getSeoOverride(locale, path)]);
  const description = metaDescription(a.excerpt || a.title);
  // hreflang only to the languages this article is published in.
  const languages = Object.fromEntries(a.locales.map((l) => [l, `/${l}${path}`]));
  if (a.locales.includes('uz')) languages['x-default'] = `/uz${path}`;
  return withSeoOverride(
    {
      title: a.title,
      description,
      alternates: { canonical: `/${locale}${path}`, languages },
      openGraph: {
        title: a.title,
        description,
        type: 'article',
        images: a.cover
          ? [
              {
                url: a.cover.url,
                width: a.cover.width ?? undefined,
                height: a.cover.height ?? undefined,
              },
            ]
          : [],
      },
    },
    override,
  );
}

/** One Ilhom article (CMS blocks, cover, optional video link, related products). */
export default async function ArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) notFound();
  setRequestLocale(locale);
  const [t, tc, a] = await Promise.all([
    getTranslations('ilhom'),
    getTranslations('common'),
    getArticle(locale, slug),
  ]);
  const meta = [
    a.category ? t(`cat_${a.category}`) : null,
    a.readingMinutes ? t('readingTime', { minutes: a.readingMinutes }) : null,
  ].filter(Boolean);

  return (
    <article className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-6 lg:px-6 lg:pt-2">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: a.title,
          ...(a.excerpt ? { description: a.excerpt } : {}),
          ...(a.cover ? { image: [a.cover.url] } : {}),
          ...(a.publishedAt ? { datePublished: a.publishedAt } : {}),
          dateModified: a.updatedAt,
          inLanguage: locale,
          mainEntityOfPage: absoluteUrl(locale, `${routes.inspiration}/${a.slug}`),
          publisher: { '@type': 'Organization', name: 'Forest' },
        }}
      />
      <header className="flex flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-14 lg:py-12">
        <nav aria-label={tc('breadcrumb')} className="text-[13px] text-muted">
          <Link prefetch={false} href={routes.home} className="hover:text-ink">
            {tc('home')}
          </Link>{' '}
          /{' '}
          <Link prefetch={false} href={routes.inspiration} className="hover:text-ink">
            {t('breadcrumb')}
          </Link>
        </nav>
        <h1 className="max-w-[960px] text-[34px] leading-[1.02] font-medium tracking-[-0.045em] lg:text-[64px]">
          {a.title}
        </h1>
        {meta.length ? <p className="text-sm text-muted">{meta.join(' · ')}</p> : null}
        {a.excerpt ? (
          <p className="max-w-[720px] text-[17px] leading-relaxed text-ink-2">{a.excerpt}</p>
        ) : null}
      </header>

      {a.cover ? (
        <div className="relative aspect-[16/9] overflow-hidden rounded-lg lg:aspect-[21/9] lg:rounded-xl">
          <Image
            src={a.cover.url}
            alt={a.cover.alt}
            fill
            priority
            sizes="(min-width: 1440px) 1392px, 100vw"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:gap-4">
        <div className="flex min-w-0 flex-col gap-6 rounded-lg bg-panel p-6 lg:flex-[2_1_0] lg:rounded-xl lg:px-14 lg:py-12">
          {a.videoUrl ? (
            <a
              href={a.videoUrl}
              target="_blank"
              rel="noopener"
              data-track="video_play"
              className="inline-flex w-fit items-center gap-2 rounded-pill bg-ink px-5 py-3 text-sm font-semibold text-white"
            >
              ▶ {t('watchVideo')}
              {a.videoMinutes ? ` · ${t('videoTime', { minutes: a.videoMinutes })}` : ''}
            </a>
          ) : null}
          <ArticleBlocks blocks={a.blocks} />
          <p className="text-xs text-muted">
            {t('updated', { date: formatTashkentDate(new Date(a.updatedAt)) })}
          </p>
        </div>
        {a.related.length ? (
          <aside
            aria-labelledby="related-title"
            className="flex flex-col gap-3 rounded-lg bg-panel p-5 lg:sticky lg:top-4 lg:flex-[1_1_0] lg:rounded-xl lg:p-7"
          >
            <h2 id="related-title" className="text-xl font-semibold">
              {t('related')}
            </h2>
            <ul className="flex flex-col gap-2">
              {a.related.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={routes.product(p.slug)}
                    className="flex items-center gap-3 rounded-[18px] p-2 hover:bg-off"
                  >
                    <span className="relative size-16 shrink-0 overflow-hidden rounded-[14px] bg-off">
                      {p.image ? (
                        <Image
                          src={p.image.url}
                          alt={p.image.alt}
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className="text-[13px] text-muted">
                        {p.inStock ? (
                          <Price soum={p.priceFromUzs} from locale={locale} />
                        ) : (
                          t('outOfStock')
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
      <Link
        prefetch={false}
        href={routes.inspiration}
        className="self-start px-1.5 text-sm font-semibold text-forest"
      >
        ← {t('back')}
      </Link>
    </article>
  );
}
