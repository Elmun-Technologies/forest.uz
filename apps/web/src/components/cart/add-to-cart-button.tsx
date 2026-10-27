'use client';

import { cn } from '@forest/ui';
import { Check, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCart } from './cart-provider';

/**
 * Quick add (+) used on product cards: POST /api/cart/items with the product's default variant.
 * `round` = icon button (catalog, mobile), `pill` = "+ Savatga" (home bestsellers, desktop).
 */
export function AddToCartButton({
  variantId,
  priceSoum,
  productName,
  look = 'round',
  className,
  trackList,
}: {
  variantId: string;
  priceSoum: number;
  productName: string;
  look?: 'round' | 'round-sm' | 'pill';
  className?: string;
  /** `data-track-list` for view_item_list/add_to_cart attribution (docs/07). */
  trackList?: string;
}) {
  const t = useTranslations('card');
  const { addItems } = useCart();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function add() {
    if (state === 'busy') return;
    setState('busy');
    const ok = await addItems([{ variantId, qty: 1, priceSoum }], { list: trackList ?? 'card' });
    setState(ok ? 'done' : 'idle');
    if (ok) window.setTimeout(() => setState('idle'), 1500);
  }

  const Icon = state === 'done' ? Check : Plus;
  return (
    <button
      type="button"
      onClick={add}
      aria-label={t('addLabel', { name: productName })}
      aria-busy={state === 'busy' || undefined}
      data-track="add_to_cart"
      data-track-list={trackList}
      data-variant-id={variantId}
      className={cn(
        'relative z-10 inline-flex shrink-0 items-center justify-center gap-2 rounded-pill text-white transition-colors disabled:opacity-60',
        state === 'done' ? 'bg-forest' : 'bg-ink hover:bg-dark-3',
        look === 'round' && 'size-12',
        look === 'round-sm' && 'size-9',
        look === 'pill' && 'h-[38px] px-4 text-[13px] font-semibold',
        className,
      )}
    >
      <Icon size={look === 'round' ? 18 : 14} strokeWidth={2.4} aria-hidden />
      {look === 'pill' ? <span aria-hidden>{t('add')}</span> : null}
    </button>
  );
}
