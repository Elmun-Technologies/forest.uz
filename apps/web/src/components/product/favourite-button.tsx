'use client';

import { cn } from '@forest/ui';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFavourite } from '@/lib/favourites';

/**
 * Favourite heart. Guests: stored in this browser; signed-in customers: `/me/favorites`
 * (see `lib/favourites.ts`, which also merges the guest list on login).
 */
export function FavouriteButton({
  productId,
  className,
  size = 18,
}: {
  productId: string;
  className?: string;
  size?: number;
}) {
  const t = useTranslations('card');
  const [on, toggle] = useFavourite(productId);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? t('unfavourite') : t('favourite')}
      data-track="favourite_toggle"
      className={cn(
        'relative z-10 grid place-items-center rounded-pill bg-white/92 text-ink transition-colors hover:bg-white',
        className,
      )}
    >
      <Heart size={size} strokeWidth={1.8} fill={on ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}
