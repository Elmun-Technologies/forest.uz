'use client';

import type { VariantDto } from '@forest/contracts';
import { formatSoum, litersNeeded, recommendVariants, soumToTiyin } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCart } from '@/components/cart/cart-provider';
import { track } from '@/lib/track';

const PRESETS = [
  { key: 'tumba', area: 1.5 },
  { key: 'komod', area: 3 },
  { key: 'stol', area: 2.5 },
  { key: 'shkaf', area: 8 },
] as const;

const num = (n: number) => String(n).replace('.', ',');
const parse = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, ''));

/**
 * Paint calculator: area (preset or custom) × coats ÷ coverage → liters (`litersNeeded`) →
 * cheapest in-stock variant mix (`recommendVariants`) → add the recommendation to the cart.
 */
export function PaintCalculator({
  coverage,
  variants,
}: {
  coverage: number;
  variants: VariantDto[];
}) {
  const t = useTranslations('product.calc');
  const locale = useLocale() as 'uz' | 'ru';
  const { addItems } = useCart();
  const [area, setArea] = useState('3');
  const [coats, setCoats] = useState('2');
  const [busy, setBusy] = useState(false);
  const areaId = useId();
  const coatsId = useId();

  const a = parse(area);
  const c = Math.round(parse(coats));
  const valid = a > 0 && a <= 500 && c >= 1 && c <= 5;
  const preset = PRESETS.find((p) => p.area === a);

  const rec = useMemo(
    () =>
      valid
        ? recommendVariants(
            a,
            c,
            coverage,
            variants
              .filter((v) => v.volumeMl)
              .map((v) => ({
                variantId: v.id,
                volumeMl: v.volumeMl ?? 0,
                priceTiyin: soumToTiyin(v.priceSoum),
                available: v.inStock,
              })),
          )
        : null,
    [a, c, valid, coverage, variants],
  );
  const liters = valid ? litersNeeded(a, c, coverage) : 0;
  const items = rec?.items
    .map((i) => ({ ...i, v: variants.find((v) => v.id === i.variantId) }))
    .filter((i) => i.v);
  const recText = items?.map((i) => `${i.v?.label} × ${i.qty}`).join(' + ');

  // calculator_used once the visitor's input settles (not for the initial defaults).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!valid) return;
    const id = window.setTimeout(
      () =>
        track('calculator_used', {
          areaM2: a,
          coats: c,
          liters: Math.round(liters * 100) / 100,
          ...(preset ? { preset: preset.key } : {}),
        }),
      800,
    );
    return () => window.clearTimeout(id);
  }, [a, c, valid, liters, preset]);

  async function add() {
    if (!items?.length || busy) return;
    setBusy(true);
    await addItems(
      items.map((i) => ({ variantId: i.variantId, qty: i.qty, priceSoum: i.v?.priceSoum })),
      { list: 'calculator' },
    );
    setBusy(false);
  }

  return (
    <section
      aria-labelledby="calc-title"
      data-testid="calculator"
      className="flex min-w-0 flex-col gap-3 rounded-lg bg-sage p-5 lg:flex-[2_1_380px] lg:gap-5 lg:rounded-xl lg:p-10"
    >
      <span className="hidden text-[13px] font-semibold tracking-[0.08em] uppercase lg:block">
        {t('overline')}
      </span>
      <h2
        id="calc-title"
        className="text-xl font-semibold tracking-[-0.02em] lg:text-[36px] lg:leading-[1.05] lg:font-medium lg:tracking-[-0.035em]"
      >
        <span className="lg:hidden">{t('titleShort')}</span>
        <span className="hidden lg:inline">{t('title')}</span>
      </h2>
      <div className="flex flex-wrap gap-1.5 lg:gap-2">
        {PRESETS.map((p) => {
          const on = preset?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => setArea(num(p.area))}
              data-track="calculator_used"
              className={cn(
                'rounded-xs px-2.5 py-2 text-left text-xs lg:rounded-2xl lg:px-3.5 lg:py-2.5 lg:text-[13px]',
                on ? 'bg-ink text-white' : 'bg-white',
              )}
            >
              <b className="lg:block lg:text-sm">{t(`presets.${p.key}`)}</b>{' '}
              {t('presetArea', { area: num(p.area) })}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2.5">
        <label
          htmlFor={areaId}
          className="flex flex-1 flex-col gap-0.5 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-muted"
        >
          {t('area')}
          <input
            id={areaId}
            inputMode="decimal"
            value={area}
            onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
            aria-invalid={!valid || undefined}
            className="w-full bg-transparent p-0 text-xl font-semibold text-ink focus:outline-none"
          />
        </label>
        <label
          htmlFor={coatsId}
          className="flex flex-1 flex-col gap-0.5 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-muted"
        >
          {t('coats')}
          <input
            id={coatsId}
            type="number"
            inputMode="numeric"
            min={1}
            max={5}
            value={coats}
            onChange={(e) => setCoats(e.target.value.slice(0, 1))}
            aria-invalid={!valid || undefined}
            className="w-full bg-transparent p-0 text-xl font-semibold text-ink focus:outline-none"
          />
        </label>
      </div>
      <div
        aria-live="polite"
        className="flex flex-col gap-2.5 rounded-[18px] bg-white p-3.5 lg:rounded-[24px] lg:p-5"
      >
        {!valid ? (
          <p className="text-sm text-muted">{t('invalid')}</p>
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span
                data-testid="calc-liters"
                className="text-[40px] leading-none font-semibold tracking-[-0.04em] text-forest lg:text-5xl"
              >
                {num(liters)}
              </span>
              <span className="text-muted">{t('liters')}</span>
            </p>
            <p className="text-[13px] text-muted">
              {t('formula', { area: num(a), coats: c, coverage: num(coverage) })}
            </p>
            {rec && recText ? (
              <p className="flex justify-between gap-3 border-t border-line pt-2.5 text-sm">
                <span data-testid="calc-recommendation">{t('recommend', { items: recText })}</span>
                <b className="tabular whitespace-nowrap">{formatSoum(rec.totalTiyin, locale)}</b>
              </p>
            ) : (
              <p className="border-t border-line pt-2.5 text-sm text-muted">{t('unavailable')}</p>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={add}
        disabled={!rec || busy}
        aria-busy={busy || undefined}
        data-track="calculator_add_to_cart"
        className="h-[52px] rounded-pill bg-ink text-[15px] font-semibold text-white transition-colors hover:bg-dark-3 disabled:opacity-50"
      >
        {t('add')}
      </button>
    </section>
  );
}
