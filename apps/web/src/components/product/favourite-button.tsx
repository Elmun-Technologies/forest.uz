'use client';

import { cn } from '@forest/ui';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const KEY = 'fr_favs';

function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Favourite heart. Stored per browser until the account favourites API (`/me/favorites`)
 * is wired — then this component syncs to it for identified customers.
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
  const [on, setOn] = useState(false);
  useEffect(() => setOn(readFavs().includes(productId)), [productId]);

  function toggle() {
    const favs = readFavs();
    const next = favs.includes(productId)
      ? favs.filter((x) => x !== productId)
      : [...favs, productId];
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(-100)));
    } catch {
      /* storage disabled */
    }
    setOn(next.includes(productId));
  }

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
