import type { Locale } from '@forest/contracts';
import type { ReactNode } from 'react';
import { ShopChrome } from '@/components/layout/shop-chrome';

export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // The root [locale] layout already rejected unknown locales.
  return <ShopChrome locale={locale as Locale}>{children}</ShopChrome>;
}
