import type { Locale } from '@forest/contracts';
import type { ReactNode } from 'react';
import { FloatingActions } from '@/components/layout/floating-actions';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { TopBar } from '@/components/layout/top-bar';
import { LeadPopup } from '@/components/lead/lead-popup';
import { getCategories, getHomeContent, getSettings } from '@/lib/data';

/**
 * Storefront frame: delivery bar → header → `<main>` → footer + global islands (Telegram FAB,
 * mobile cart bar, exit-intent popup). Checkout and login use their own minimal frame (`(flow)`).
 *
 * Pages that draw their own compact mobile header (cart) render `<MobileFlowMarker />`; the
 * `[data-chrome-mobile]` parts are then hidden below `lg` by CSS (globals.css), without JS.
 */
export async function ShopChrome({
  locale,
  inFlowFrame = false,
  children,
}: {
  locale: Locale;
  /** Rendered inside the flow frame's `<main>` (flow 404): don't open a second `<main>`. */
  inFlowFrame?: boolean;
  children: ReactNode;
}) {
  const [settings, categories, home] = await Promise.all([
    getSettings(locale),
    getCategories(locale),
    getHomeContent(locale),
  ]);
  return (
    <>
      <div data-chrome-mobile>
        {settings ? <TopBar settings={settings} locale={locale} /> : null}
      </div>
      <Header
        locale={locale}
        phone={settings?.store.phone ?? null}
        hours={settings?.store.hours[locale] ?? null}
      />
      {inFlowFrame ? <div>{children}</div> : <main id="main">{children}</main>}
      <div data-chrome-mobile>
        <Footer settings={settings} categories={categories} locale={locale} />
        <div aria-hidden className="h-20 lg:hidden" />
      </div>
      <FloatingActions telegramBot={settings?.store.telegramBot ?? null} />
      <LeadPopup
        telegramBot={settings?.store.telegramBot ?? null}
        before={home?.hero?.before ?? null}
        after={home?.hero?.after ?? null}
        fallback={home?.selector.find((s) => s.image)?.image ?? null}
      />
    </>
  );
}

/** Rendered by pages with their own compact mobile header (see `ShopChrome`). */
export function MobileFlowMarker() {
  return <span hidden data-mobile-flow />;
}
