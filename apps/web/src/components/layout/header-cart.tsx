'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { BagIcon } from './icons';

/** Desktop "Savat [n]" pill with the live cart count. */
export function CartPill() {
  const t = useTranslations('header');
  const { count } = useCart();
  return (
    <Link
      href={routes.cart}
      aria-label={t('cartLabel', { count })}
      data-track="header_cart"
      className="inline-flex h-12 items-center gap-2.5 rounded-pill bg-ink pr-2 pl-5 text-sm font-semibold text-white transition-colors hover:bg-dark-3"
    >
      {t('cart')}
      <span
        data-testid="cart-count"
        className="tabular grid h-8 min-w-8 place-items-center rounded-pill bg-white px-2 text-[13px] text-ink"
      >
        {count}
      </span>
    </Link>
  );
}

/** Mobile round cart button with a count badge. */
export function CartIconLink() {
  const t = useTranslations('header');
  const { count } = useCart();
  return (
    <Link
      href={routes.cart}
      aria-label={t('cartLabel', { count })}
      className="relative grid size-11 place-items-center rounded-pill bg-ink text-white"
    >
      <BagIcon />
      {count > 0 ? (
        <span
          aria-hidden
          className="tabular absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-sage px-1 text-[11px] font-bold text-ink"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
