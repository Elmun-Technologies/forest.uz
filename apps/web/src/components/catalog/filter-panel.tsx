'use client';

import type { ProductListDto } from '@forest/contracts';
import { formatAmount, soumToTiyin, SURFACES } from '@forest/contracts/core';
import { cn, Switch } from '@forest/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { CatalogFilters } from '@/lib/catalog-params';
import { volumeLabel } from '@/lib/catalog-params';
import { toggle, useCatalogNav } from './use-catalog-nav';

type Facets = ProductListDto['facets'];

const groupTitle = 'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase';
const group = 'flex flex-col gap-3 border-t border-line pt-5';

/**
 * Catalog filters, URL-synced (`?surface=&color=&volume=&priceMin=&priceMax=&brand=&onSale=`).
 * Rendered in the desktop aside and inside the mobile bottom sheet.
 */
export function FilterPanel({
  filters,
  facets,
  idPrefix,
}: {
  filters: CatalogFilters;
  facets: Facets;
  idPrefix: string;
}) {
  const t = useTranslations('catalog');
  const { apply } = useCatalogNav(filters);

  // Keep selected values visible even when the facet no longer lists them.
  const colors = [...facets.colors];
  for (const hex of filters.color)
    if (!colors.some((c) => c.hex.replace('#', '').toLowerCase() === hex))
      colors.push({ hex: `#${hex}`, label: `#${hex.toUpperCase()}`, count: 0 });
  const volumes = [...facets.volumes];
  for (const v of filters.volume)
    if (!volumes.some((x) => String(x.volumeMl) === v))
      volumes.push({ volumeMl: Number(v), label: volumeLabel(Number(v)), count: 0 });

  return (
    <div className="flex flex-col gap-7">
      <fieldset className={group}>
        <legend className={cn(groupTitle, 'float-left mb-3 w-full')}>{t('surface')}</legend>
        {SURFACES.map((s) => (
          <label key={s} className="flex min-h-7 cursor-pointer items-center gap-2.5 text-[15px]">
            <input
              type="checkbox"
              checked={filters.surface.includes(s)}
              onChange={() => apply({ surface: toggle(filters.surface, s) })}
              className="size-[18px] accent-forest"
            />
            {t(`surfaces.${s}`)}
          </label>
        ))}
      </fieldset>

      {colors.length > 0 ? (
        <fieldset className={group}>
          <legend className={cn(groupTitle, 'float-left mb-3 w-full')}>{t('color')}</legend>
          <div className="flex flex-wrap gap-2.5">
            {colors.map((c) => {
              const key = c.hex.replace('#', '').toLowerCase();
              const on = filters.color.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  aria-label={c.label}
                  title={c.label}
                  data-testid={`color-${key}`}
                  onClick={() => apply({ color: toggle(filters.color, key) })}
                  className={cn(
                    'size-9 rounded-pill',
                    on ? 'border-2 border-ink shadow-[inset_0_0_0_3px_#fff]' : 'border border-line',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {volumes.length > 0 ? (
        <fieldset className={group}>
          <legend className={cn(groupTitle, 'float-left mb-3 w-full')}>{t('volume')}</legend>
          <div className="flex flex-wrap gap-2">
            {volumes.map((v) => {
              const key = String(v.volumeMl);
              const on = filters.volume.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  data-testid={`volume-${key}`}
                  onClick={() => apply({ volume: toggle(filters.volume, key) })}
                  className={cn(
                    'rounded-pill px-3.5 py-2 text-sm transition-colors',
                    on ? 'bg-ink text-white' : 'border border-line hover:border-ink',
                  )}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <PriceRange filters={filters} facets={facets} idPrefix={idPrefix} apply={apply} />

      {facets.brands.length > 0 ? (
        <fieldset className={group}>
          <legend className={cn(groupTitle, 'float-left mb-3 w-full')}>{t('brand')}</legend>
          {facets.brands.map((b) => (
            <label
              key={b.slug}
              className="flex min-h-7 cursor-pointer items-center gap-2.5 text-[15px]"
            >
              <input
                type="checkbox"
                checked={filters.brand.includes(b.slug)}
                onChange={() => apply({ brand: toggle(filters.brand, b.slug) })}
                className="size-[18px] accent-forest"
              />
              {b.name}
              {b.isOfficial ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted">
                  <Check size={12} aria-hidden />
                  {t('official')}
                </span>
              ) : null}
            </label>
          ))}
          <p className="text-xs leading-normal text-muted">{t('brandNote')}</p>
        </fieldset>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5 text-[15px]">
        <label htmlFor={`${idPrefix}-sale`}>{t('onSale')}</label>
        <Switch
          id={`${idPrefix}-sale`}
          checked={filters.onSale}
          onCheckedChange={(v) => apply({ onSale: v })}
        />
      </div>
    </div>
  );
}

function PriceRange({
  filters,
  facets,
  idPrefix,
  apply,
}: {
  filters: CatalogFilters;
  facets: Facets;
  idPrefix: string;
  apply: (patch: Partial<CatalogFilters>) => void;
}) {
  const t = useTranslations('catalog');
  const lo = facets.price.minSoum;
  const hi = Math.max(facets.price.maxSoum, lo + 1000);
  const [min, setMin] = useState(filters.priceMin ?? lo);
  const [max, setMax] = useState(filters.priceMax ?? hi);
  const legendId = useId();
  useEffect(() => {
    setMin(filters.priceMin ?? lo);
    setMax(filters.priceMax ?? hi);
  }, [filters.priceMin, filters.priceMax, lo, hi]);

  const commit = (nextMin = min, nextMax = max) => {
    const a = Math.max(0, Math.min(nextMin, nextMax));
    const b = Math.max(nextMin, nextMax);
    apply({ priceMin: a > lo ? a : undefined, priceMax: b < hi ? b : undefined });
  };
  const pct = (v: number) => `${((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const step = 1000;
  const fmt = (n: number) => formatAmount(soumToTiyin(n));

  return (
    <fieldset className={cn(group, 'gap-3.5')} aria-labelledby={legendId}>
      <legend id={legendId} className={cn(groupTitle, 'float-left mb-3.5 w-full')}>
        {t('price')}
      </legend>
      <div className="relative h-5">
        <span aria-hidden className="absolute inset-x-0 top-2 h-1 rounded-[2px] bg-[#E3E6DD]" />
        <span
          aria-hidden
          className="absolute top-2 h-1 rounded-[2px] bg-forest"
          style={{ left: pct(min), right: `calc(100% - ${pct(max)})` }}
        />
        <input
          type="range"
          aria-label={t('priceMin')}
          min={lo}
          max={hi}
          step={step}
          value={min}
          onChange={(e) => setMin(Math.min(Number(e.target.value), max))}
          onPointerUp={() => commit()}
          onKeyUp={() => commit()}
          className="price-range absolute inset-0 w-full"
        />
        <input
          type="range"
          aria-label={t('priceMax')}
          min={lo}
          max={hi}
          step={step}
          value={max}
          onChange={(e) => setMax(Math.max(Number(e.target.value), min))}
          onPointerUp={() => commit()}
          onKeyUp={() => commit()}
          className="price-range absolute inset-0 w-full"
        />
      </div>
      <div className="flex gap-2">
        {(['min', 'max'] as const).map((k) => (
          <input
            key={k}
            id={`${idPrefix}-price-${k}`}
            aria-label={k === 'min' ? t('priceMin') : t('priceMax')}
            inputMode="numeric"
            value={fmt(k === 'min' ? min : max)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, '')) || 0;
              if (k === 'min') setMin(n);
              else setMax(n);
            }}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            className="tabular h-11 w-full min-w-0 flex-1 rounded-sm border border-line px-3 text-sm focus:border-ink focus:outline-none"
          />
        ))}
      </div>
    </fieldset>
  );
}
