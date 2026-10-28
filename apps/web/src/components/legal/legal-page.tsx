import type {
  ContentBlock,
  ContentPageDto,
  LegalSlug,
  Locale,
  PublicSettingsDto,
} from '@forest/contracts';
import { formatTashkentDate } from '@forest/contracts/core';
import { cn, Price } from '@forest/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ApiError, apiGet } from '@/lib/api';
import { getSettings } from '@/lib/data';
import { soum } from '@/lib/format';
import { alternates, metaDescription } from '@/lib/seo';
import { getSeoOverride, withSeoOverride } from '@/lib/seo-meta';

type Props = { params: Promise<{ locale: Locale }> };

async function loadPage(slug: LegalSlug, locale: Locale): Promise<ContentPageDto> {
  try {
    return await apiGet<ContentPageDto>(`/content/pages/LEGAL/${slug}`, locale, {
      revalidate: 300,
      tags: ['content', `page:${slug}`],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

/**
 * Route module for one legal document (`/oferta`, `/maxfiylik`, `/qaytarish`, `/yetkazish-tolov`;
 * design: Huquqiy). Body = structured blocks from the CMS; blocks with missing company data are
 * already removed by the API, and `draft` shows the lawyer-review notice (CLAUDE.md decision).
 */
export function legalRoute(slug: LegalSlug, opts: { zones?: boolean } = {}) {
  async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { locale } = await params;
    const [page, t, override] = await Promise.all([
      loadPage(slug, locale),
      getTranslations({ locale, namespace: 'legal' }),
      getSeoOverride(locale, `/${slug}`),
    ]);
    return withSeoOverride(
      {
        title: page.title,
        description: metaDescription(
          t('metaDescription', { title: page.title, subtitle: page.subtitle ?? '' }),
        ),
        alternates: alternates(locale, `/${slug}`),
      },
      override,
    );
  }

  async function LegalPage({ params }: Props) {
    const { locale } = await params;
    setRequestLocale(locale);
    const [page, t, tc, settings] = await Promise.all([
      loadPage(slug, locale),
      getTranslations('legal'),
      getTranslations('common'),
      opts.zones ? getSettings(locale) : null,
    ]);
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-6 lg:px-6 lg:pt-2">
        <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-12 lg:py-10">
          <div className="flex flex-col gap-4">
            <nav aria-label={tc('breadcrumb')} className="text-[13px] text-muted">
              <Link href={routes.home} className="hover:text-ink">
                {tc('home')}
              </Link>{' '}
              / <span>{t('breadcrumb')}</span>
            </nav>
            <p className="text-[36px] leading-[0.95] font-medium tracking-[-0.05em] lg:text-[72px]">
              {t('title')}
            </p>
          </div>
          {page.draft ? (
            <p
              role="note"
              data-testid="legal-draft"
              className="max-w-[360px] rounded-sm bg-warn-bg px-4 py-3 text-[13px] leading-normal font-semibold text-warn"
            >
              {t('draft')}
            </p>
          ) : null}
        </section>
        <section className="flex flex-wrap items-start gap-2.5 lg:gap-4">
          <nav
            aria-label={t('docs')}
            className="flex w-full flex-col gap-1 rounded-lg bg-panel p-3 lg:max-w-[320px] lg:flex-[1_1_260px] lg:rounded-[32px] lg:p-4"
          >
            {page.siblings.map((s) => {
              const current = s.slug === page.slug;
              return (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 flex-col gap-0.5 rounded-[20px] px-3.5 py-3',
                    current ? 'bg-ink text-white' : 'hover:bg-canvas',
                  )}
                >
                  <b className="text-[15px] font-semibold">{s.title}</b>
                  {s.subtitle ? <span className="text-xs opacity-70">{s.subtitle}</span> : null}
                </Link>
              );
            })}
            <p className="px-3.5 pt-3 pb-1 text-xs leading-normal text-muted">
              {t('updated', { date: formatTashkentDate(new Date(page.updatedAt)) })}
              {page.version ? <> · {t('version', { version: page.version })}</> : null}
            </p>
          </nav>
          <article className="flex min-w-0 flex-[999_1_560px] flex-col gap-[22px] rounded-lg bg-panel p-6 text-[15px] leading-[1.7] text-[#2A2E26] lg:rounded-[32px] lg:px-12 lg:py-10">
            <h1 className="text-[30px] leading-[1.1] font-medium tracking-[-0.03em] text-ink lg:text-[36px]">
              {page.title}
            </h1>
            {settings ? <ZonesTable settings={settings} locale={locale} /> : null}
            {page.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </article>
        </section>
      </div>
    );
  }

  return { generateMetadata, LegalPage };
}

/** Live delivery zones from settings (admin A16) — never copied into the CMS text. */
async function ZonesTable({ settings, locale }: { settings: PublicSettingsDto; locale: Locale }) {
  const t = await getTranslations('legal');
  const tc = await getTranslations('common');
  const zones = settings.delivery.zones;
  if (!zones.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-ink">{t('zonesTitle')}</h2>
      <div className="overflow-x-auto rounded-[20px] border border-line">
        <table
          className="tabular w-full min-w-[620px] border-collapse text-sm"
          data-testid="delivery-zones"
        >
          <thead className="bg-off text-left text-xs text-muted">
            <tr>
              {(['zone', 'service', 'eta', 'price', 'free'] as const).map((c) => (
                <th key={c} scope="col" className="px-[18px] py-3 font-medium">
                  {t(`zoneCols.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.key} className="border-t border-line-soft">
                <th scope="row" className="px-[18px] py-4 text-left font-semibold">
                  {z.name[locale]}
                </th>
                <td className="px-[18px] py-4">{tc(`carrier.${z.carrier}`)}</td>
                <td className="px-[18px] py-4">{z.etaLabel[locale]}</td>
                <td className="px-[18px] py-4">
                  <Price soum={z.priceSoum} locale={locale} />
                </td>
                <td className="px-[18px] py-4">
                  {z.freeFromSoum
                    ? t('freeFrom', { amount: soum(z.freeFromSoum, locale) })
                    : t('noFree')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Block({ block: b }: { block: ContentBlock }) {
  switch (b.type) {
    case 'h2':
      return <h2 className="mt-2 text-xl font-semibold text-ink">{b.text}</h2>;
    case 'h3':
      return <h3 className="mt-1 text-[17px] font-semibold text-ink">{b.text}</h3>;
    case 'p':
      return <p>{b.text}</p>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={cn(
            'flex flex-col gap-1.5 pl-[22px]',
            b.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {b.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </Tag>
      );
    }
    case 'dl':
      return (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-[20px] bg-off px-6 py-5 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
          {b.items.map((d) => (
            <div key={d.term} className="contents">
              <dt className="text-muted">{d.term}</dt>
              <dd className="font-semibold text-ink">{d.desc}</dd>
            </div>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-[20px] border border-line">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-off text-left text-xs text-muted">
              <tr>
                {b.head.map((h) => (
                  <th key={h} scope="col" className="px-[18px] py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i} className="border-t border-line-soft">
                  {row.map((cell, j) =>
                    j === 0 ? (
                      <th key={j} scope="row" className="px-[18px] py-4 text-left font-semibold">
                        {cell}
                      </th>
                    ) : (
                      <td key={j} className="px-[18px] py-4">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'note':
      return (
        <p
          className={cn(
            'rounded-[20px] px-5 py-4 text-sm',
            b.tone === 'warn' ? 'bg-warn-bg text-warn' : 'bg-sage-50 text-ink-2',
          )}
        >
          {b.text}
        </p>
      );
    case 'faq':
      return (
        <div className="flex flex-col divide-y divide-line">
          {b.items.map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink">
                {f.q}
              </summary>
              <p className="pt-1">{f.a}</p>
            </details>
          ))}
        </div>
      );
  }
}
