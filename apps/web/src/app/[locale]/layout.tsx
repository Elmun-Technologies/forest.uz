import type { Locale } from '@forest/contracts';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { ClientMessages } from '@/components/client-messages';
import { CartProvider } from '@/components/cart/cart-provider';
import { ReplayGate } from '@/components/analytics/replay-gate';
import { TrackerLoader } from '@/components/analytics/tracker-loader';
import { ConsentBanner } from '@/components/layout/consent-banner';
import { OfflineBanner } from '@/components/layout/offline-banner';
import { ToastProvider } from '@/components/ui/toast';
import { getSettings } from '@/lib/data';
import { alternates } from '@/lib/seo';
import { RECORDER_VERSION } from '@forest/replay';
import { TRACKER_VERSION } from '@forest/tracker';
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
  // Frames live in route groups: `(shop)` = header/footer, `(flow)` = checkout/login.
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const tc = await getTranslations('common');
  const replay = (await getSettings(locale))?.replay ?? null;

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
              {children}
              <OfflineBanner />
              <ConsentBanner />
              <ReplayGate config={replay} version={RECORDER_VERSION} />
              <TrackerLoader src={`/t.js?v=${TRACKER_VERSION}`} />
            </CartProvider>
          </ToastProvider>
        </ClientMessages>
      </body>
    </html>
  );
}
