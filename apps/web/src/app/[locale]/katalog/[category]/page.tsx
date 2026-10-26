import type { Locale } from '@forest/contracts';
import { CatalogPage, catalogMetadata } from '@/lib/catalog-page';

type Props = {
  params: Promise<{ locale: Locale; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props) {
  const { locale, category } = await params;
  return catalogMetadata(locale, category, searchParams);
}

export default async function Page({ params, searchParams }: Props) {
  const { locale, category } = await params;
  return <CatalogPage locale={locale} slug={category} searchParams={searchParams} />;
}
