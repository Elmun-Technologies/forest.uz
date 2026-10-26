import type { Locale } from '@forest/contracts';
import { CatalogPage, catalogMetadata } from '@/lib/catalog-page';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props) {
  const { locale } = await params;
  return catalogMetadata(locale, null, searchParams);
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  return <CatalogPage locale={locale} slug={null} searchParams={searchParams} />;
}
