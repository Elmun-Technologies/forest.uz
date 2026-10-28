'use client';

import type { SelectorItemDto } from '@forest/contracts';
import { cn, Price } from '@forest/ui';
import { Check } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { track } from '@/lib/track';

/**
 * "Nimani yangilaymiz?" — pick an item → recommended kit with live price and one-tap
 * add-to-cart. Selector users convert ×3 (docs/01), so every step carries a `data-track` hook.
 */
export function QuickSelector({ items }: { items: SelectorItemDto[] }) {
  const t = useTranslations('home.selector');
  const locale = useLocale() as 'uz' | 'ru';
  const { addItems } = useCart();
  const [key, setKey] = useState(() => (items.find((i) => i.key === 'divan') ?? items[0])?.key);
  const [busy, setBusy] = useState(false);
  const sel = items.find((i) => i.key === key) ?? items[0];
  if (!sel) return null;

  async function addKit() {
    if (!sel || busy) return;
    setBusy(true);
    await addItems(
      sel.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
      { list: 'selector' },
    );
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-stretch lg:gap-4">
      <ul className="grid min-w-0 grid-cols-3 gap-2 lg:flex-[3_1_620px] lg:gap-3">
        {items.map((it) => {
          const on = it.key === sel.key;
          return (
            <li key={it.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setKey(it.key);
                  track('selector_used', { item: it.key });
                  track('selector_result', {
                    item: it.key,
                    inStock: it.inStock,
                    priceSoum: it.priceSoum,
                    items: it.items.length,
                  });
                }}
                data-track="selector_used"
                data-selector-item={it.key}
                className={cn(
                  'relative block h-[104px] w-full overflow-hidden rounded-2xl bg-forest text-left text-white lg:h-[220px] lg:rounded-[24px]',
                  on &&
                    'shadow-[0_0_0_3px_var(--color-ink)] lg:shadow-[0_0_0_4px_var(--color-ink)]',
                )}
              >
                {it.image ? (
                  <Image
                    src={it.image.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 260px, 33vw"
                    className="object-cover"
                  />
                ) : null}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-ink/80 to-ink/0 to-65% lg:from-ink/78 lg:to-60%"
                />
                <span className="absolute inset-x-2.5 bottom-[9px] flex items-end justify-between gap-2 lg:inset-x-[18px] lg:bottom-4">
                  <span className="flex flex-col gap-0.5">
                    <b className="text-[13px] font-semibold lg:text-xl">{it.name}</b>
                    <span className="hidden text-xs opacity-85 lg:block">{it.kind}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'hidden size-[30px] shrink-0 place-items-center rounded-pill lg:grid',
                      on ? 'bg-white text-ink' : 'border-2 border-white/80 text-transparent',
                    )}
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div
        aria-live="polite"
        data-track="selector_result"
        data-selector-item={sel.key}
        className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-ink p-5 text-white lg:flex-[2_1_400px] lg:gap-[22px] lg:rounded-[32px] lg:p-9"
      >
        <span className="text-[11px] font-semibold tracking-[0.08em] text-on-dark-subtle uppercase lg:text-[13px]">
          <span className="lg:hidden">{t('recForShort', { name: sel.name })}</span>
          <span className="hidden lg:inline">{t('recFor', { name: sel.name })}</span>
        </span>
        <h3 className="text-[22px] leading-[1.15] font-medium tracking-[-0.02em] lg:text-[32px] lg:leading-[1.1] lg:tracking-[-0.03em]">
          {sel.title}
        </h3>
        <p className="text-[13px] leading-normal text-on-dark-muted lg:text-[15px] lg:leading-[1.55]">
          {sel.contents}
          {sel.timeLabel ? <span className="lg:hidden"> · {sel.timeLabel}</span> : null}
        </p>
        {sel.areaLabel || sel.timeLabel ? (
          <dl className="hidden grid-cols-2 gap-2.5 lg:grid">
            {sel.areaLabel ? (
              <div className="flex flex-col gap-1 rounded-[18px] bg-dark-2 px-4 py-3.5">
                <dt className="text-xs text-on-dark-subtle">{t('area')}</dt>
                <dd className="text-lg font-semibold">{sel.areaLabel}</dd>
              </div>
            ) : null}
            {sel.timeLabel ? (
              <div className="flex flex-col gap-1 rounded-[18px] bg-dark-2 px-4 py-3.5">
                <dt className="text-xs text-on-dark-subtle">{t('time')}</dt>
                <dd className="text-lg font-semibold">{sel.timeLabel}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className="flex flex-col gap-2.5 border-t border-dark-3 pt-3 lg:pt-5">
          {sel.newItemPriceSoum ? (
            <p className="flex justify-between gap-3 text-[13px] text-on-dark-muted lg:text-[15px]">
              <span className="lg:hidden">{t('buyNewShort')}</span>
              <span className="hidden lg:inline">{t('buyNew')}</span>
              <s className="tabular">
                <Price soum={sel.newItemPriceSoum} locale={locale} />
              </s>
            </p>
          ) : null}
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] lg:text-[15px]">
              <span className="lg:hidden">{t('withForestShort')}</span>
              <span className="hidden lg:inline">{t('withForest')}</span>
            </span>
            <Price
              soum={sel.priceSoum}
              locale={locale}
              className="text-[26px] font-semibold tracking-[-0.02em] lg:text-[34px] lg:tracking-[-0.03em]"
            />
          </p>
        </div>
        <button
          type="button"
          onClick={addKit}
          disabled={!sel.inStock || busy}
          aria-busy={busy || undefined}
          data-track="selector_add_to_cart"
          data-selector-item={sel.key}
          className="mt-auto h-[52px] rounded-pill bg-white text-[15px] font-semibold text-ink transition-colors hover:bg-sage-50 disabled:opacity-60 lg:h-auto lg:px-6 lg:py-[18px] lg:text-base"
        >
          {!sel.inStock ? (
            t('soon')
          ) : (
            <>
              <span className="lg:hidden">{t('addShort')}</span>
              <span className="hidden lg:inline">{t('add')}</span>
            </>
          )}
        </button>
        {sel.productSlug ? (
          <Link
            href={routes.product(sel.productSlug)}
            className="hidden text-center text-sm text-on-dark-muted underline hover:text-white lg:block"
          >
            {t('details')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
