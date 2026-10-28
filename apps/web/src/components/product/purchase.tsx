'use client';

import type { ProductCardDto, PublicSettingsDto, VariantDto } from '@forest/contracts';
import { parseUzPhone } from '@forest/contracts/core';
import { Button, cn, PhoneInput, Price, Stepper } from '@forest/ui';
import { Clock } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { type PromiseLine, promiseLine } from '@/lib/delivery';
import { track } from '@/lib/track';
import { FavouriteButton } from './favourite-button';

type Zone = PublicSettingsDto['delivery']['zones'][number];

interface PurchaseState {
  productId: string;
  name: string;
  image: string | null;
  variants: VariantDto[];
  coverage: number | null;
  variant: VariantDto;
  setVariantId: (id: string) => void;
  qty: number;
  setQty: (n: number) => void;
  busy: boolean;
  add: () => Promise<boolean>;
  buyNow: () => Promise<void>;
  express: Zone | null;
  /** Main CTA row is visible → sticky bar hidden. */
  ctaVisible: boolean;
  ctaRef: (el: HTMLElement | null) => void;
}

const Ctx = createContext<PurchaseState | null>(null);
function usePurchase(): PurchaseState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePurchase outside <PurchaseProvider>');
  return v;
}

/**
 * Selected variant + quantity shared by the buy box, the sticky bars and the SKU label.
 * Server-rendered content (title, description) is passed through as children.
 */
export function PurchaseProvider({
  productId,
  name,
  image,
  variants,
  defaultVariantId,
  coverage,
  express,
  children,
}: {
  productId: string;
  name: string;
  image: string | null;
  variants: VariantDto[];
  defaultVariantId: string | null;
  coverage: number | null;
  express: Zone | null;
  children: ReactNode;
}) {
  const initial =
    variants.find((v) => v.id === defaultVariantId && v.inStock) ??
    variants.find((v) => v.inStock) ??
    variants.find((v) => v.id === defaultVariantId) ??
    variants[0];
  const [variantId, setVariantIdState] = useState(initial?.id ?? '');
  const [qty, setQtyState] = useState(1);
  const [busy, setBusy] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(true);
  const { addItems } = useCart();
  const router = useRouter();
  const variant = variants.find((v) => v.id === variantId) ?? initial;

  // Desktop sticky bar appears once the main CTA row has scrolled above the viewport. A scroll
  // listener (not IntersectionObserver) so jumps like anchor links or restored scroll count too.
  const ctaEl = useRef<HTMLElement | null>(null);
  const ctaRef = useCallback((el: HTMLElement | null) => {
    ctaEl.current = el;
  }, []);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ctaEl.current;
      setCtaVisible(!el || el.getBoundingClientRect().bottom > 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !initial) return;
    viewed.current = true;
    track('view_item', { productId, variantId: initial.id, priceSoum: initial.priceSoum });
  }, [productId, initial]);
  useEffect(() => {
    const root = document.documentElement;
    if (ctaVisible) delete root.dataset.buybar;
    else root.dataset.buybar = '';
    return () => {
      delete root.dataset.buybar;
    };
  }, [ctaVisible]);

  if (!variant) return <>{children}</>;
  const max = Math.max(1, Math.min(99, variant.available || 1));

  async function add() {
    if (!variant?.inStock || busy) return false;
    setBusy(true);
    const ok = await addItems([{ variantId: variant.id, qty, priceSoum: variant.priceSoum }], {
      list: 'product',
    });
    setBusy(false);
    return ok;
  }

  const state: PurchaseState = {
    productId,
    name,
    image,
    variants,
    coverage,
    variant,
    setVariantId: (id) => {
      if (id !== variant.id) track('select_variant', { productId, variantId: id });
      setVariantIdState(id);
      setQtyState(1);
    },
    qty,
    setQty: (n) => setQtyState(Math.min(max, Math.max(1, n))),
    busy,
    add,
    buyNow: async () => {
      if (await add()) router.push(routes.cart);
    },
    express,
    ctaVisible,
    ctaRef,
  };
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function SkuLabel() {
  const t = useTranslations('product');
  const { variant } = usePurchase();
  return (
    <span className="hidden text-[13px] text-muted lg:inline">
      {t('sku', { sku: variant.sku })}
    </span>
  );
}

/** Volume / colour variants with the price-relevant hint (≈ m² for paints). */
export function VariantPicker() {
  const t = useTranslations('product');
  const locale = useLocale() as 'uz' | 'ru';
  const { variants, variant, setVariantId, coverage } = usePurchase();
  if (variants.length < 2) return null;
  const byVolume = variants.every((v) => v.volumeMl && !v.colorHex);
  return (
    <fieldset className="flex flex-col gap-3 lg:border-t lg:border-line lg:pt-6">
      <legend className="sr-only lg:not-sr-only lg:float-left lg:mb-3 lg:w-full lg:text-[13px] lg:font-semibold lg:tracking-[0.08em] lg:text-muted lg:uppercase">
        {byVolume ? t('volume') : t('variant')}
      </legend>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const on = v.id === variant.id;
          const area = coverage && v.volumeMl ? Math.round((coverage * v.volumeMl) / 1000) : null;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => setVariantId(v.id)}
              data-track="select_variant"
              data-variant-id={v.id}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors lg:min-w-[110px] lg:flex-none lg:rounded-[18px] lg:px-[18px] lg:py-3',
                on ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-ink',
                !v.inStock && !on && 'text-muted',
              )}
            >
              <span className="flex items-center gap-2 text-[15px] font-semibold lg:text-base">
                {v.colorHex ? (
                  <span
                    aria-hidden
                    className="size-4 rounded-pill border border-line"
                    style={{ backgroundColor: v.colorHex }}
                  />
                ) : null}
                {v.label}
              </span>
              <span className="text-[11px] opacity-75 lg:text-xs">
                {!v.inStock ? (
                  t('soon')
                ) : area ? (
                  t('areaHint', { area })
                ) : (
                  <Price soum={v.priceSoum} locale={locale} withCurrency={false} />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useDeliveryPromise(): { line: PromiseLine; eta: string } | null {
  const { express } = usePurchase();
  const locale = useLocale() as 'uz' | 'ru';
  const now = useNow();
  if (!express) return null;
  // Before hydration render the generic ETA (server and client agree), then the live time.
  return {
    line: now ? promiseLine(express, now) : { kind: 'generic' },
    eta: express.etaLabel[locale],
  };
}

export function StockAndDelivery() {
  const t = useTranslations('product');
  const { variant } = usePurchase();
  const promise = useDeliveryPromise();
  const b = (chunks: ReactNode) => <b className="font-semibold">{chunks}</b>;
  if (!variant.inStock) {
    return (
      <p className="flex items-center gap-2.5 text-sm">
        <span aria-hidden className="size-2.5 rounded-pill bg-subtle" />
        <b className="font-semibold">{t('soon')}</b>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-[13px] lg:text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 lg:gap-2.5">
        <span
          aria-hidden
          className="size-2 rounded-pill bg-live lg:size-2.5 lg:shadow-[0_0_0_4px_rgb(62_142_78/0.18)]"
        />
        <b className="font-semibold">{t('inStock')}</b>
        {variant.lowStock ? (
          <span className="text-muted">{t('lowStock', { count: variant.available })}</span>
        ) : null}
        {promise ? (
          <span className="text-muted lg:hidden" data-testid="delivery-promise-short">
            {promise.line.kind === 'today'
              ? t('deliveryShortToday', { time: promise.line.time })
              : promise.line.kind === 'tomorrow'
                ? t('deliveryShortTomorrow', { time: promise.line.time })
                : t('deliveryShortGeneric', { eta: promise.eta })}
          </span>
        ) : null}
      </p>
      {promise ? (
        <p
          className="hidden items-center gap-2.5 text-ink-2 lg:flex"
          data-testid="delivery-promise"
        >
          <Clock size={16} strokeWidth={2} className="shrink-0 text-forest" aria-hidden />
          <span>
            {promise.line.kind === 'today'
              ? t.rich('deliveryToday', { time: promise.line.time, b })
              : promise.line.kind === 'tomorrow'
                ? t.rich('deliveryTomorrow', { time: promise.line.time, b })
                : t.rich('deliveryGeneric', { eta: promise.eta, b })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

const qtyLabels = (t: (k: string) => string) => ({
  decrease: t('qty.decrease'),
  increase: t('qty.increase'),
  value: t('qty.value'),
});

/** Desktop price + qty row and CTA buttons (mobile uses the sticky bar). */
export function BuyBox() {
  const t = useTranslations('product');
  const locale = useLocale() as 'uz' | 'ru';
  const p = usePurchase();
  const { variant } = p;
  return (
    <>
      <div className="hidden flex-wrap items-center gap-4 border-t border-line pt-6 lg:flex">
        <Price
          soum={variant.priceSoum * p.qty}
          compareAtSoum={variant.compareAtSoum ? variant.compareAtSoum * p.qty : null}
          locale={locale}
          className="mr-auto text-[40px] font-semibold tracking-[-0.03em] [&_s]:text-base"
        />
        {variant.inStock ? (
          <Stepper
            value={p.qty}
            onChange={p.setQty}
            max={Math.min(99, variant.available)}
            labels={qtyLabels(t)}
          />
        ) : null}
      </div>
      <StockAndDelivery />
      {variant.inStock ? (
        <div ref={p.ctaRef} className="hidden flex-wrap gap-2.5 lg:flex">
          <Button
            size="lg"
            onClick={() => void p.add()}
            loading={p.busy}
            data-track="add_to_cart"
            data-variant-id={variant.id}
            className="h-16 flex-[1_1_200px] text-base"
          >
            {t('addToCart')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void p.buyNow()}
            disabled={p.busy}
            data-track="buy_now"
            className="h-16 flex-[1_1_200px] border-[1.5px] text-base"
          >
            {t('buyNow')}
          </Button>
          <FavouriteButton
            productId={p.productId}
            size={22}
            className="size-16 border border-line bg-panel"
          />
        </div>
      ) : (
        <Waitlist variantId={variant.id} />
      )}
    </>
  );
}

function Waitlist({ variantId }: { variantId: string }) {
  const t = useTranslations('product.waitlist');
  const tl = useTranslations('lead.errors');
  const tc = useTranslations('common');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const id = useId();
  if (state === 'done') {
    return (
      <p role="status" className="rounded-[18px] bg-good-bg p-4 text-sm font-semibold text-good">
        {t('done')}
      </p>
    );
  }
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseUzPhone(digits);
        if (!parsed.ok) return setError(tl(parsed.error));
        setState('busy');
        try {
          await clientApi.catalog.waitlist({ variantId, phone: parsed.e164 });
          track('waitlist_join', { variantId });
          setState('done');
        } catch (err) {
          setState('idle');
          setError(
            err instanceof ClientApiError && err.code === 'NETWORK' ? tl('network') : tl('generic'),
          );
        }
      }}
      className="flex flex-col gap-1.5"
      data-testid="waitlist"
    >
      <label htmlFor={id} className="text-[13px] font-semibold">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <PhoneInput
          id={id}
          value={digits}
          onValueChange={(v) => {
            setDigits(v);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          aria-label={tc('phone')}
          className="min-w-0 flex-1"
          inputClassName="rounded-pill"
        />
        <Button type="submit" size="lg" loading={state === 'busy'} data-track="waitlist_join">
          {t('submit')}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="px-4 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** "Hozir bor muqobil" — first in-stock alternative, shown only when the variant is out of stock. */
export function InStockAlternative({ alternatives }: { alternatives: ProductCardDto[] }) {
  const t = useTranslations('product.waitlist');
  const locale = useLocale() as 'uz' | 'ru';
  const { variant } = usePurchase();
  const alt = alternatives.find((a) => a.inStock && a.defaultVariantId);
  if (variant.inStock || !alt?.defaultVariantId) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="alternative">
      <span className="text-[13px] font-semibold">{t('alternative')}</span>
      <div className="relative flex items-center gap-3 rounded-[18px] bg-off p-2.5">
        {alt.image ? (
          <Image
            src={alt.image.url}
            alt=""
            width={48}
            height={48}
            sizes="48px"
            className="size-12 rounded-xs object-cover"
          />
        ) : null}
        <Link
          href={routes.product(alt.slug)}
          className="flex-1 text-sm after:absolute after:inset-0"
        >
          {alt.name}
        </Link>
        <Price
          soum={alt.priceFromSoum}
          locale={locale}
          withCurrency={false}
          className="text-sm font-bold"
        />
        <AddToCartButton
          variantId={alt.defaultVariantId}
          priceSoum={alt.priceFromSoum}
          productName={alt.name}
          look="round-sm"
          trackList="product_alternative"
        />
      </div>
    </div>
  );
}

/** Sticky buy bars: desktop dark pill after scrolling past the CTA; mobile white bar always. */
export function StickyBuyBar() {
  const t = useTranslations('product');
  const locale = useLocale() as 'uz' | 'ru';
  const p = usePurchase();
  const { variant } = p;
  return (
    <>
      <div
        aria-hidden={p.ctaVisible}
        className={cn(
          'fixed inset-x-4 bottom-4 z-30 hidden transition-[opacity,transform] duration-200 lg:block',
          p.ctaVisible ? 'pointer-events-none translate-y-4 opacity-0' : 'opacity-100',
        )}
        data-testid="sticky-buy-bar"
        inert={p.ctaVisible || undefined}
      >
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 rounded-pill bg-ink py-2.5 pr-2.5 pl-3 text-white shadow-[0_12px_32px_rgb(20_23_18/0.28)]">
          {p.image ? (
            <Image
              src={p.image}
              alt=""
              width={52}
              height={52}
              sizes="52px"
              className="size-[52px] shrink-0 rounded-pill object-cover"
            />
          ) : null}
          <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
            <b className="truncate text-[15px] font-semibold">{p.name}</b>
            <span className="text-[13px] text-on-dark-muted">
              {t('sticky', {
                variant: variant.label,
                qty: p.qty,
                hours: p.express?.promiseHours ?? 12,
              })}
            </span>
          </span>
          <Price
            soum={variant.priceSoum * p.qty}
            locale={locale}
            className="text-[22px] font-semibold tracking-[-0.02em]"
          />
          <Button
            variant="inverse"
            size="lg"
            onClick={() => void p.add()}
            loading={p.busy}
            disabled={!variant.inStock}
            data-track="add_to_cart"
            className="px-[26px]"
          >
            {variant.inStock ? t('addToCart') : t('soon')}
          </Button>
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2.5 border-t border-line bg-panel px-3 pt-2.5 pb-4 lg:hidden"
        data-testid="mobile-buy-bar"
      >
        <span className="flex min-w-0 flex-col">
          <Price
            soum={variant.priceSoum * p.qty}
            locale={locale}
            className="text-xl font-bold tracking-[-0.02em] whitespace-nowrap"
          />
          <span className="truncate text-[11px] text-muted">
            {variant.label} · {p.name}
          </span>
        </span>
        {variant.inStock ? (
          <Stepper
            value={p.qty}
            onChange={p.setQty}
            max={Math.min(99, variant.available)}
            labels={qtyLabels(t)}
            size="md"
            className="ml-auto"
          />
        ) : null}
        <Button
          onClick={() => void p.add()}
          loading={p.busy}
          disabled={!variant.inStock}
          data-track="add_to_cart"
          className={cn('h-[50px] px-5 text-[15px]', !variant.inStock && 'ml-auto')}
        >
          {variant.inStock ? t('addShort') : t('soon')}
        </Button>
      </div>
    </>
  );
}
