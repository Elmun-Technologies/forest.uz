import type { Locale } from '@forest/contracts';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';
import { ClientMessages } from '@/components/client-messages';
import { Link, redirect } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { getMe } from '@/lib/customer';
import { getHomeContent } from '@/lib/data';
import { alternates } from '@/lib/seo';
import logoWhite from '../../../../../public/brand/forest-logo-white.png';
import logoGreen from '../../../../../public/brand/forest-logo-green.png';

// Per-request page: the [locale] layout's generateStaticParams would otherwise mark it static,
// and its cookie/searchParams read would fail at runtime (DYNAMIC_SERVER_USAGE).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'login' });
  return {
    title: t('metaTitle'),
    alternates: alternates(locale, routes.login),
    robots: { index: false, follow: false },
  };
}

/** Same-site, locale-less return path (`/buyurtma/x`, `/t/x`); anything else → cabinet. */
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return routes.account;
  return v.replace(/^\/(uz|ru)(?=\/|$)/, '') || routes.account;
}

/** `/{locale}/kirish` — SMS code login (design: Kirish). Telegram Login is not wired yet. */
export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next);
  if (await getMe(locale)) redirect({ href: next, locale });
  const [t, home] = await Promise.all([getTranslations('login'), getHomeContent(locale)]);
  // Admin-managed photo (hero "after" or lead image); without one the panel stays brand green.
  const photo = home?.hero?.after ?? home?.leadImage ?? null;

  return (
    <div className="flex min-h-dvh flex-wrap gap-4 p-3 lg:p-4">
      <div className="relative hidden min-h-[600px] min-w-0 flex-[1_1_560px] overflow-hidden rounded-xl bg-forest lg:block">
        {photo ? (
          <Image
            src={photo.url}
            alt={photo.alt}
            fill
            priority
            sizes="50vw"
            className="object-cover"
          />
        ) : null}
        <span className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/0 to-ink/35" />
        <Link href={routes.home} aria-label={t('homeLabel')} className="absolute top-9 left-10">
          <Image src={logoWhite} alt="Forest" width={150} sizes="150px" />
        </Link>
        <p className="absolute right-10 bottom-10 left-10 text-[48px] leading-[1.05] font-medium tracking-[-0.04em] text-white">
          {t('photoTitle')}
        </p>
      </div>
      <div className="flex min-w-0 flex-[1_1_520px] flex-col justify-center gap-8 rounded-xl bg-panel p-6 sm:p-10 lg:p-16">
        <Link href={routes.home} aria-label={t('homeLabel')} className="w-24 lg:hidden">
          <Image src={logoGreen} alt="Forest" width={96} sizes="96px" />
        </Link>
        <div className="flex max-w-[440px] flex-col gap-3.5">
          <h1 className="text-[44px] leading-[0.95] font-medium tracking-[-0.05em] lg:text-[72px]">
            {t('title')}
          </h1>
          <p className="leading-relaxed text-muted">{t('lead')}</p>
        </div>
        <ClientMessages namespaces={['login']}>
          <LoginForm next={next} />
        </ClientMessages>
        <p className="max-w-[440px] text-xs leading-normal text-muted">
          {t.rich('terms', {
            offer: (c) => (
              <Link href={routes.offer} className="text-ink underline">
                {c}
              </Link>
            ),
            privacy: (c) => (
              <Link href={routes.privacy} className="text-ink underline">
                {c}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
