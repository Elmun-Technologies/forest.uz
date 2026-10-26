import type { Locale, ProductCardDto } from '@forest/contracts';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProductCard } from '@/components/product/product-card';
import { apiGet } from '@/lib/api';

export default async function FavoritesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [items, t] = await Promise.all([
    apiGet<ProductCardDto[]>('/me/favorites', locale, { personal: true }),
    getTranslations('account'),
  ]);
  return (
    <section className="flex flex-col gap-5 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-10 lg:py-9">
      <h1 className="text-[36px] font-medium tracking-[-0.04em] lg:text-5xl">{t('favorites')}</h1>
      {items.length ? (
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] lg:gap-4">
          {items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} locale={locale} list="favorites" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t('noFavorites')}</p>
      )}
    </section>
  );
}
