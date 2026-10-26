import type { Locale } from '@forest/contracts';
import { getLocale } from 'next-intl/server';
import { NotFoundPanel } from '@/components/errors/not-found-panel';
import { ShopChrome } from '@/components/layout/shop-chrome';

/** 404 outside the shop frame (flow pages): render the storefront chrome around it. */
export default async function NotFound() {
  const locale = (await getLocale()) as Locale;
  return (
    <ShopChrome locale={locale}>
      <NotFoundPanel />
    </ShopChrome>
  );
}
