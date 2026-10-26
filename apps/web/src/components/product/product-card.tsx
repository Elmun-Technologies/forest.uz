import type { ProductCardDto } from '@forest/contracts';
import { cn, Price } from '@forest/ui';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { FavouriteButton } from './favourite-button';

/** First badge to show on a card: −N % beats Xit/Yangi (design). */
export function useCardBadge(p: Pick<ProductCardDto, 'badges' | 'discountPct'>): string | null {
  const t = useTranslations('card');
  if (p.discountPct) return t('discount', { pct: p.discountPct });
  if (p.badges.includes('HIT')) return t('badges.HIT');
  if (p.badges.includes('NEW')) return t('badges.NEW');
  return null;
}

/**
 * Product card for the catalog grid and home bestsellers. Works in server and client trees
 * (load-more appends cards client-side). The name link is stretched over the card; the
 * favourite and quick-add buttons sit above it.
 */
export function ProductCard({
  product: p,
  locale,
  look = 'catalog',
  priority = false,
  list,
}: {
  product: ProductCardDto;
  locale: 'uz' | 'ru';
  look?: 'catalog' | 'home';
  priority?: boolean;
  list: string;
}) {
  const t = useTranslations('card');
  const badge = useCardBadge(p);
  const variantId = p.inStock ? p.defaultVariantId : null;
  return (
    <article
      data-testid="product-card"
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[22px] bg-panel md:gap-4 md:rounded-[32px] md:p-3',
        look === 'catalog' ? 'md:pb-6' : 'md:pb-5',
      )}
    >
      <div className="relative h-[170px] overflow-hidden bg-[#E3E6DD] md:aspect-[4/5] md:h-auto md:rounded-[24px]">
        {p.image ? (
          <Image
            src={p.image.url}
            alt={p.image.alt || p.name}
            fill
            priority={priority}
            sizes="(min-width: 1280px) 290px, (min-width: 768px) 33vw, 50vw"
            className={cn('object-cover', !p.inStock && 'opacity-80 grayscale-[0.6]')}
          />
        ) : null}
        {badge || !p.inStock ? (
          <span className="absolute top-2 left-2 rounded-pill bg-white px-[9px] py-1 text-[11px] font-bold md:top-3.5 md:left-3.5 md:px-3.5 md:py-[7px] md:text-xs md:font-semibold">
            {p.inStock ? badge : t('soon')}
          </span>
        ) : null}
        {look === 'catalog' ? (
          <>
            <FavouriteButton
              productId={p.id}
              className="absolute top-3.5 right-3.5 hidden size-10 md:grid"
            />
            {variantId ? (
              <AddToCartButton
                variantId={variantId}
                priceSoum={p.priceFromSoum}
                productName={p.name}
                trackList={list}
                className="absolute right-3.5 bottom-3.5 hidden md:inline-flex"
              />
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-2.5 pb-3 md:px-2.5 md:py-0">
        <span className="hidden text-xs font-semibold tracking-[0.08em] text-muted uppercase md:block">
          {p.categoryName}
        </span>
        <h3 className="min-h-[34px] text-[13px] leading-[1.3] font-semibold md:min-h-0 md:text-[17px] md:tracking-[-0.01em]">
          <Link
            href={routes.product(p.slug)}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[inherit] focus-visible:after:outline-3 focus-visible:after:outline-forest"
          >
            {p.name}
          </Link>
        </h3>
        <span className={cn('text-[11px] text-muted md:text-[13px]', look === 'home' && 'hidden')}>
          {p.subtitle}
        </span>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 md:mt-1.5">
          <span className="flex items-baseline gap-2">
            <Price
              soum={p.priceFromSoum}
              from={p.hasPriceRange}
              locale={locale}
              withCurrency={false}
              className="text-sm font-bold md:hidden"
            />
            <Price
              soum={p.priceFromSoum}
              from={p.hasPriceRange}
              compareAtSoum={look === 'catalog' ? p.compareAtSoum : null}
              locale={locale}
              className="hidden text-lg font-bold md:inline-flex [&_s]:text-[13px] [&_s]:text-muted"
            />
          </span>
          {variantId ? (
            <>
              <AddToCartButton
                variantId={variantId}
                priceSoum={p.priceFromSoum}
                productName={p.name}
                look="round-sm"
                trackList={list}
                className="md:hidden"
              />
              {look === 'home' ? (
                <AddToCartButton
                  variantId={variantId}
                  priceSoum={p.priceFromSoum}
                  productName={p.name}
                  look="pill"
                  trackList={list}
                  className="hidden md:inline-flex"
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
