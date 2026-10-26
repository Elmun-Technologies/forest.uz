import type { Locale } from '@forest/contracts';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { ClientMessages } from '@/components/client-messages';
import { CartProvider } from '@/components/cart/cart-provider';
import { ConsentBanner } from '@/components/layout/consent-banner';
import { FloatingActions } from '@/components/layout/floating-actions';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { TopBar } from '@/components/layout/top-bar';
import { LeadPopup } from '@/components/lead/lead-popup';
import { ToastProvider } from '@/components/ui/toast';
import { getCategories, getHomeContent, getSettings } from '@/lib/data';
import { alternates } from '@/lib/seo';
import '../globals.css';

// No build-time prerender: pages need live API data (prices, stock), so they render on first
// request and are cached via fetch revalidation (ISR). Builds must never depend on a running API.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const settings = await getSettings(locale);
  return {
    metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
    title: { default: t('title'), template: '%s | Forest' },
    description: t('description'),
    alternates: alternates(locale, '/'),
    openGraph: { siteName: 'Forest', locale: locale === 'ru' ? 'ru_RU' : 'uz_UZ', type: 'website' },
    verification: {
      google: settings?.seo.google ?? undefined,
      yandex: settings?.seo.yandex ?? undefined,
      other: settings?.seo.bing ? { 'msvalidate.01': settings.seo.bing } : undefined,
    },
  };
}

export const viewport: Viewport = { themeColor: '#EEEFEA', width: 'device-width', initialScale: 1 };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [settings, categories, home, tc] = await Promise.all([
    getSettings(locale),
    getCategories(locale),
    getHomeContent(locale),
    getTranslations('common'),
  ]);

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <ClientMessages>
          <ToastProvider>
            <CartProvider>
              <a
                href="#main"
                className="sr-only z-[80] rounded-pill bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
              >
                {tc('skipToContent')}
              </a>
              {settings ? <TopBar settings={settings} locale={locale} /> : null}
              <Header
                locale={locale}
                phone={settings?.store.phone ?? null}
                hours={settings?.store.hours[locale] ?? null}
              />
              <main id="main">{children}</main>
              <Footer settings={settings} categories={categories} locale={locale} />
              <div aria-hidden className="h-20 lg:hidden" />
              <FloatingActions telegramBot={settings?.store.telegramBot ?? null} />
              <ConsentBanner />
              <LeadPopup
                telegramBot={settings?.store.telegramBot ?? null}
                before={home?.hero?.before ?? null}
                after={home?.hero?.after ?? null}
                fallback={home?.selector.find((s) => s.image)?.image ?? null}
              />
            </CartProvider>
          </ToastProvider>
        </ClientMessages>
      </body>
    </html>
  );
}
