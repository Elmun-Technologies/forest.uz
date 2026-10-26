import type { Locale, ProductCardDto, PublicSettingsDto } from '@forest/contracts';
import { Badge, Panel, Price } from '@forest/ui';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/**
 * Phase 0 foundation page: proves the stack end-to-end (web → api → db seed → object storage).
 * Replaced by the full Home screen (design/screens/Main.png) in Phase 1.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const [products, settings] = await Promise.all([
    apiGet<ProductCardDto[]>('/catalog/bestsellers', locale),
    apiGet<PublicSettingsDto>('/settings/public', locale),
  ]);
  const express = settings.delivery.zones.find((z) => z.carrier === 'YANDEX');

  return (
    <main className="mx-auto flex max-w-[1392px] flex-col gap-6 px-4 py-8 md:px-6">
      <Panel radius="xl" className="flex flex-col gap-4 p-8 md:p-12">
        <h1 className="text-[44px] leading-[0.95] font-medium tracking-[-0.05em] md:text-display">
          {t('title')}
        </h1>
        {express ? (
          <p className="text-muted">
            {express.name[locale]} · {express.etaLabel[locale]}
          </p>
        ) : null}
      </Panel>
      <section aria-labelledby="bestsellers" className="flex flex-col gap-4">
        <h2 id="bestsellers" className="text-[30px] font-medium tracking-[-0.04em] md:text-h2">
          {t('bestsellers')}
        </h2>
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((p) => (
            <li key={p.id}>
              <Panel radius="md" className="flex h-full flex-col gap-3 p-3">
                {p.image ? (
                  <Image
                    src={p.image.url}
                    alt={p.image.alt}
                    width={p.image.width ?? 800}
                    height={p.image.height ?? 800}
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="aspect-square w-full rounded-sm object-cover"
                  />
                ) : null}
                {p.discountPct ? <Badge tone="light">−{p.discountPct}%</Badge> : null}
                <span className="text-overline font-semibold tracking-[0.08em] text-muted uppercase">
                  {p.categoryName}
                </span>
                <span className="font-semibold">{p.name}</span>
                <Price
                  className="mt-auto font-bold"
                  soum={p.priceFromSoum}
                  from={p.hasPriceRange}
                  locale={locale}
                />
              </Panel>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
