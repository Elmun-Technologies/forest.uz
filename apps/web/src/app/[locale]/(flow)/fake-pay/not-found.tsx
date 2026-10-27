import type { Locale } from '@forest/contracts';
import { getLocale } from 'next-intl/server';
import { NotFoundPanel } from '@/components/errors/not-found-panel';
import { ShopChrome } from '@/components/layout/shop-chrome';

/**
 * 404 of the flow frame (only `/fake-pay` can 404 there): render the storefront chrome around it.
 * It lives here, not in `[locale]/not-found.tsx`, because Next serialises every ancestor's
 * not-found element into each page's RSC payload — at the `[locale]` level the whole shop chrome
 * (header, footer, popup) would ship a second time with every storefront page.
 */
export default async function NotFound() {
  const locale = (await getLocale()) as Locale;
  return (
    <ShopChrome locale={locale} inFlowFrame>
      <NotFoundPanel />
    </ShopChrome>
  );
}
