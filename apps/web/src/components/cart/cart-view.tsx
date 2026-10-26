'use client';

import type { CartDto, CartLineDto, ImageDto } from '@forest/contracts';
import { UZ_REGIONS } from '@forest/contracts/core';
import { Badge, Button, cn, Price, Skeleton, Stepper } from '@forest/ui';
import { ArrowLeft, Check, ChevronLeft, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { useToast } from '@/components/ui/toast';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { soum } from '@/lib/format';
import { optionEta, readRegion, storeRegion, useDeliveryQuote } from './use-quote';

type Locale = 'uz' | 'ru';

export interface CartViewProps {
  locale: Locale;
  returnDays: number | null;
  cod: boolean;
  /** Empty-state tiles ("Mebel →", "Divan →"): categories with a photo. */
  tiles: { slug: string; name: string; image: ImageDto | null }[];
}

/**
 * Cart page body (design: Savat, Mobil-Savat). Server state is the CartDto; every mutation
 * returns a fresh one, which is pushed into the global cart store so the header stays in sync.
 * Shipping is re-priced for the chosen region (`GET /cart?zone=`), since mutations price the
 * default express zone.
 */
export function CartView({ locale, returnDays, cod, tiles }: CartViewProps) {
  const t = useTranslations('cartPage');
  const tc = useTranslations('common');
  const toast = useToast();
  const { cart, status, setCart, addItems } = useCart();
  const [region, setRegion] = useState('tashkent_city');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const saved = readRegion();
    if (saved && UZ_REGIONS.some((r) => r.code === saved)) setRegion(saved);
  }, []);

  const quote = useDeliveryQuote(
    cart && cart.lines.length ? region : null,
    null,
    cart?.totals.subtotalSoum,
  );
  const option = quote.options[0] ?? null;
  const zoneKey = option?.zoneKey ?? null;

  // Re-price shipping for the chosen zone whenever the zone or the cart contents change.
  const signature = cart ? `${cart.totals.subtotalSoum}:${cart.promo?.code ?? ''}` : '';
  useEffect(() => {
    if (!zoneKey || !signature) return;
    let live = true;
    clientApi.cart
      .get(zoneKey)
      .then((dto) => live && setCart(dto))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [zoneKey, signature, setCart]);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ClientApiError && e.code === 'NETWORK') toast(tc('network'), 'critical');
      else if (e instanceof ClientApiError && e.status < 500) toast(e.message, 'critical');
      else toast(t('updateFailed'), 'critical');
    },
    [t, tc, toast],
  );

  async function mutate(key: string, run: () => Promise<CartDto>) {
    setBusy(key);
    try {
      setCart(await run());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  if (status === 'loading' && !cart) return <CartSkeleton />;
  if (status === 'unavailable')
    return (
      <p role="alert" className="rounded-lg bg-panel p-8 text-muted">
        {t('unavailable')}
      </p>
    );
  if (!cart || cart.lines.length === 0) return <EmptyCart tiles={tiles} />;

  const totals = cart.totals;
  // `freeShippingRemainingSoum` is null once the threshold is reached → full bar, "bepul".
  const threshold = totals.freeShippingThresholdSoum;
  const remaining = totals.freeShippingRemainingSoum ?? 0;
  const freeProgress = threshold
    ? { remaining, pct: Math.min(100, Math.round(((threshold - remaining) / threshold) * 100)) }
    : null;
  const eta = option ? optionEta(option) : null;
  const etaText =
    option && eta
      ? eta.kind === 'generic'
        ? t('etaGeneric', { zone: option.name, eta: option.etaLabel })
        : t(eta.kind === 'today' ? 'etaToday' : 'etaTomorrow', {
            zone: option.name,
            time: eta.time,
          })
      : null;
  const shipping =
    totals.shippingSoum === null ? null : totals.shippingSoum === 0 ? (
      tc('freeShipping')
    ) : (
      <Price soum={totals.shippingSoum} locale={locale} />
    );
  const blocking = cart.lines.some((l) => l.insufficient);

  return (
    <>
      {/* Mobile compact header (global header is hidden on this page below lg). */}
      <div className="sticky top-0 z-30 -mx-3 flex items-center gap-2 bg-canvas px-4 py-3 lg:hidden">
        <Link
          href={routes.catalog}
          aria-label={tc('back')}
          className="grid size-11 place-items-center rounded-pill bg-panel"
        >
          <ChevronLeft size={18} aria-hidden />
        </Link>
        <h1 className="flex-1 text-center text-base font-semibold">
          {t('mobileTitle', { count: totals.itemsCount })}
        </h1>
        <span aria-hidden className="w-11" />
      </div>

      <div className="flex flex-wrap items-start gap-2.5 lg:gap-4">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-2.5 lg:gap-4">
          {freeProgress ? (
            <section className="flex flex-col gap-2.5 rounded-md bg-panel px-4 py-3.5 lg:gap-3 lg:rounded-[32px] lg:px-8 lg:py-6">
              <p className="text-[13px] leading-snug lg:text-[15px]" aria-live="polite">
                {freeProgress.remaining > 0 ? (
                  t('freeLeft', { amount: soum(freeProgress.remaining, locale) })
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={14} aria-hidden /> {t('freeReached')}
                  </span>
                )}
              </p>
              <div
                role="progressbar"
                aria-label={t('freeProgress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={freeProgress.pct}
                className="h-1.5 overflow-hidden rounded-pill bg-canvas lg:h-2"
              >
                <span
                  className="block h-full rounded-pill bg-forest transition-[width] duration-300"
                  style={{ width: `${freeProgress.pct}%` }}
                />
              </div>
            </section>
          ) : null}

          <section
            aria-label={t('title')}
            className="flex flex-col gap-2.5 lg:gap-0 lg:rounded-[32px] lg:bg-panel lg:px-8 lg:py-2"
          >
            <ul className="flex flex-col gap-2.5 lg:gap-0">
              {cart.lines.map((l) => (
                <CartLine
                  key={l.variantId}
                  line={l}
                  locale={locale}
                  busy={busy === l.variantId}
                  onQty={(qty) =>
                    void mutate(l.variantId, () => clientApi.cart.setQty(l.variantId, qty))
                  }
                  onRemove={() =>
                    void mutate(l.variantId, () => clientApi.cart.remove(l.variantId))
                  }
                />
              ))}
            </ul>
            <div className="hidden flex-wrap items-center justify-between gap-4 py-5 lg:flex">
              <Link
                href={routes.catalog}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2"
              >
                <ArrowLeft size={14} aria-hidden />
                {t('continue')}
              </Link>
              <span className="text-[13px] text-muted">{t('saved')}</span>
            </div>
          </section>

          {cart.upsell ? (
            <section className="flex items-center gap-3 rounded-md bg-sage p-3 lg:flex-wrap lg:gap-5 lg:rounded-[32px] lg:p-5">
              {cart.upsell.image ? (
                <span className="relative size-14 shrink-0 overflow-hidden rounded-sm lg:size-24 lg:rounded-[22px]">
                  <Image
                    src={cart.upsell.image.url}
                    alt=""
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:basis-64 lg:gap-1">
                <span className="hidden text-[13px] font-semibold tracking-[0.08em] uppercase lg:block">
                  {t('upsellOverline')}
                </span>
                <Link
                  href={routes.product(cart.upsell.productSlug)}
                  className="text-[13px] font-bold lg:text-lg lg:font-semibold"
                >
                  {cart.upsell.name}
                </Link>
                <span className="text-xs text-ink-2 lg:text-sm">{cart.upsell.reason}</span>
              </span>
              <Button
                size="sm"
                aria-label={t('upsellAddLabel', { name: cart.upsell.name })}
                data-track="add_to_cart"
                data-track-list="cart_upsell"
                data-variant-id={cart.upsell.variantId}
                loading={busy === 'upsell'}
                onClick={async () => {
                  const u = cart.upsell;
                  if (!u) return;
                  setBusy('upsell');
                  await addItems([{ variantId: u.variantId, qty: 1, priceSoum: u.priceSoum }]);
                  setBusy(null);
                }}
                className="lg:h-12 lg:px-[22px] lg:text-sm"
              >
                <span className="lg:hidden">+ {t('upsellAdd')}</span>
                <span className="hidden lg:inline">
                  + <Price soum={cart.upsell.priceSoum} locale={locale} />
                </span>
              </Button>
            </section>
          ) : null}
        </div>

        <aside
          aria-label={t('summaryLabel')}
          className="flex w-full min-w-0 flex-[1_1_380px] flex-col gap-2.5 lg:gap-5 lg:rounded-xl lg:bg-ink lg:p-9 lg:text-white"
        >
          <h2 className="hidden text-[26px] font-semibold tracking-[-0.02em] lg:block">
            {t('summary')}
          </h2>
          <div className="flex flex-col gap-2.5 rounded-md bg-panel px-4 py-3.5 lg:order-none lg:gap-5 lg:rounded-none lg:bg-transparent lg:p-0">
            <dl className="flex flex-col gap-2.5 text-sm lg:gap-3 lg:border-t lg:border-dark-3 lg:pt-5 lg:text-[15px]">
              <Row label={t('items', { count: totals.itemsCount })}>
                <Price soum={totals.subtotalSoum} locale={locale} />
              </Row>
              {cart.promo?.status === 'applied' ? (
                <Row
                  className="font-semibold text-good lg:font-normal lg:text-white"
                  label={`${t('discount')} · ${cart.promo.code}`}
                >
                  −<Price soum={totals.discountSoum} locale={locale} />
                </Row>
              ) : totals.discountSoum > 0 ? (
                <Row label={t('discount')}>
                  −<Price soum={totals.discountSoum} locale={locale} />
                </Row>
              ) : null}
              <Row label={option ? t('deliveryZone', { zone: option.name }) : t('delivery')}>
                {shipping ?? '—'}
              </Row>
            </dl>
            <PromoForm cart={cart} onCart={setCart} />
            <RegionSelect
              value={region}
              locale={locale}
              onChange={(r) => {
                setRegion(r);
                storeRegion(r);
              }}
            />
            <div className="flex items-baseline justify-between border-t border-line-soft pt-2.5 lg:border-dark-3 lg:pt-5">
              <span className="text-lg font-bold lg:text-base lg:font-normal">{t('total')}</span>
              <Price
                soum={totals.totalSoum}
                locale={locale}
                className="text-lg font-bold lg:text-[36px] lg:font-semibold lg:tracking-[-0.03em]"
              />
            </div>
          </div>
          {etaText ? (
            <p className="flex items-center gap-2.5 px-1.5 text-xs text-muted lg:hidden">
              {option ? (
                <Logo
                  src={logos.light[option.carrier === 'YANDEX' ? 'YANDEX' : 'BTS']}
                  alt={logoAlt[option.carrier === 'YANDEX' ? 'YANDEX' : 'BTS']}
                  className="h-3"
                />
              ) : null}
              <span aria-live="polite">{etaText}</span>
            </p>
          ) : null}
          <Link
            href={routes.checkout}
            aria-disabled={blocking || undefined}
            data-track="begin_checkout"
            data-testid="to-checkout"
            className={cn(
              'hidden h-16 items-center justify-center rounded-pill bg-white text-base font-semibold text-ink transition-colors hover:bg-sage-50 lg:flex',
              blocking && 'pointer-events-none opacity-50',
            )}
          >
            {t('checkout')}
          </Link>
          <ul className="flex flex-wrap items-center justify-center gap-2">
            {(['PAYME', 'CLICK'] as const).map((m) => (
              <li
                key={m}
                className="inline-flex items-center lg:h-10 lg:rounded-pill lg:border lg:border-[#3A4035] lg:px-4"
              >
                <Logo src={logos.light[m]} alt={logoAlt[m]} className="h-4 lg:hidden" />
                <Logo src={logos.dark[m]} alt={logoAlt[m]} className="hidden h-[17px] lg:block" />
              </li>
            ))}
            {cod ? (
              <li className="text-xs text-muted lg:inline-flex lg:h-10 lg:items-center lg:rounded-pill lg:border lg:border-[#3A4035] lg:px-3.5 lg:text-[13px] lg:font-semibold lg:text-white">
                <span className="lg:hidden">· {t('codShort')}</span>
                <span className="hidden lg:inline">{t('cod')}</span>
              </li>
            ) : null}
          </ul>
          {etaText ? (
            <p className="hidden items-center gap-3 border-t border-dark-3 pt-5 text-[13px] text-on-dark-muted lg:flex">
              {option ? (
                <Logo
                  src={logos.dark[option.carrier === 'YANDEX' ? 'YANDEX' : 'BTS']}
                  alt={logoAlt[option.carrier === 'YANDEX' ? 'YANDEX' : 'BTS']}
                  className={option.carrier === 'YANDEX' ? 'h-[13px]' : 'h-6'}
                />
              ) : null}
              {etaText}
            </p>
          ) : null}
          <ul className="hidden flex-col gap-2.5 border-t border-dark-3 pt-5 text-[13px] text-on-dark-muted lg:flex">
            {returnDays ? (
              <li className="flex items-center gap-2.5">
                <Check size={16} className="text-on-dark-subtle" aria-hidden />
                {t('returns', { days: returnDays })}
              </li>
            ) : null}
            <li className="flex items-center gap-2.5">
              <Check size={16} className="text-on-dark-subtle" aria-hidden />
              {t('receipt')}
            </li>
          </ul>
        </aside>
      </div>

      {/* Mobile sticky checkout bar. */}
      <nav
        aria-label={t('checkout')}
        className="sticky bottom-0 z-30 -mx-3 mt-4 bg-gradient-to-t from-canvas from-70% to-canvas/0 px-3 pt-2.5 pb-3.5 lg:hidden"
      >
        <Link
          href={routes.checkout}
          aria-disabled={blocking || undefined}
          data-track="begin_checkout"
          className={cn(
            'flex h-14 items-center justify-between rounded-pill bg-ink pr-2 pl-[22px] text-[15px] font-semibold text-white',
            blocking && 'pointer-events-none opacity-50',
          )}
        >
          {t('checkout')}
          <span className="rounded-pill bg-white px-3.5 py-2.5 text-sm text-ink">
            <Price soum={totals.totalSoum} locale={locale} withCurrency={false} />
          </span>
        </Link>
      </nav>
    </>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-between gap-3', className)}>
      <dt className="text-muted lg:text-on-dark-muted">{label}</dt>
      <dd className="tabular text-right">{children}</dd>
    </div>
  );
}

function CartLine({
  line: l,
  locale,
  busy,
  onQty,
  onRemove,
}: {
  line: CartLineDto;
  locale: Locale;
  busy: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('cartPage');
  // Never below the current qty, so an over-stock line can still be decreased.
  const max = Math.max(l.qty, Math.min(99, l.available));
  return (
    <li
      data-testid="cart-line"
      aria-busy={busy || undefined}
      className={cn(
        'flex gap-3 rounded-md bg-panel p-2.5 transition-opacity lg:flex-wrap lg:items-center lg:gap-5 lg:rounded-none lg:border-b lg:border-line lg:px-0 lg:py-6',
        busy && 'opacity-60',
      )}
    >
      <span className="relative size-[88px] shrink-0 overflow-hidden rounded-[16px] bg-canvas lg:size-[120px] lg:rounded-[24px]">
        {l.image ? (
          <Image src={l.image.url} alt="" fill sizes="120px" className="object-cover" />
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 lg:basis-56 lg:gap-1.5">
        <span className="hidden text-xs font-semibold tracking-[0.08em] text-muted uppercase lg:block">
          {l.sellerName}
          {l.isOfficialSeller ? ` · ${t('official')}` : null}
        </span>
        <Link
          href={routes.product(l.productSlug)}
          className="text-sm leading-snug font-semibold lg:text-[19px] lg:tracking-[-0.01em]"
        >
          {l.name}
        </Link>
        <span className="text-xs text-muted lg:text-sm">{l.variantLabel}</span>
        {l.isGift ? (
          <Badge tone="good" className="self-start">
            {t('gift')}
          </Badge>
        ) : null}
        {l.insufficient ? (
          <p role="alert" className="text-xs font-medium text-danger lg:text-[13px]">
            {l.available > 0 ? t('insufficient', { count: l.available }) : t('soldOut')}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 lg:hidden">
          {l.isGift ? <span /> : <LineStepper line={l} max={max} onQty={onQty} size="md" />}
          <Price
            soum={l.lineTotalSoum}
            locale={locale}
            withCurrency={false}
            className="text-[15px] font-bold"
          />
        </div>
        {l.isGift ? null : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('removeLabel', { name: l.name })}
            className="self-start text-xs text-muted underline lg:hidden"
          >
            {t('remove')}
          </button>
        )}
      </div>
      {l.isGift ? null : (
        <LineStepper line={l} max={max} onQty={onQty} size="lg" className="hidden lg:inline-flex" />
      )}
      <div className="hidden min-w-[140px] flex-col items-end gap-2 lg:flex">
        <Price soum={l.lineTotalSoum} locale={locale} className="text-[19px] font-bold" />
        {l.isGift ? null : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('removeLabel', { name: l.name })}
            data-testid="cart-remove"
            className="text-[13px] text-muted underline hover:text-ink"
          >
            {t('remove')}
          </button>
        )}
      </div>
    </li>
  );
}

function LineStepper({
  line,
  max,
  onQty,
  size,
  className,
}: {
  line: CartLineDto;
  max: number;
  onQty: (qty: number) => void;
  size: 'md' | 'lg';
  className?: string;
}) {
  const t = useTranslations('cartPage');
  return (
    <Stepper
      value={line.qty}
      onChange={onQty}
      min={1}
      max={max}
      size={size}
      labels={{
        decrease: `${t('qty.decrease')}: ${line.name}`,
        increase: `${t('qty.increase')}: ${line.name}`,
        value: `${t('qty.value')}: ${line.name}`,
      }}
      className={cn(size === 'md' && 'h-11 [&>button]:h-11 [&>button]:w-11', className)}
    />
  );
}

/** Promo input with inline, localized validation (Holatlar · 6). */
function PromoForm({ cart, onCart }: { cart: CartDto; onCart: (c: CartDto) => void }) {
  const t = useTranslations('cartPage');
  const tc = useTranslations('common');
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const applied = cart.promo?.status === 'applied' ? cart.promo : null;
  const rejected = cart.promo?.status === 'rejected' ? cart.promo : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError(t('promoEmpty'));
    setBusy(true);
    setError(null);
    try {
      const dto = await clientApi.cart.applyPromo(code.trim());
      onCart(dto);
      setCode('');
      if (dto.promo?.status === 'rejected') setError(dto.promo.message);
    } catch (err) {
      setError(
        err instanceof ClientApiError && err.code !== 'NETWORK' && err.status < 500
          ? err.message
          : err instanceof ClientApiError && err.code === 'NETWORK'
            ? tc('network')
            : tc('generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      onCart(await clientApi.cart.removePromo());
      setError(null);
    } catch {
      setError(tc('generic'));
    } finally {
      setBusy(false);
    }
  }

  const message = error ?? rejected?.message ?? null;
  return (
    <div className="flex flex-col gap-2">
      {applied ? (
        <p
          data-testid="promo-applied"
          className="flex items-center justify-between gap-2 rounded-sm bg-good-bg px-3.5 py-2.5 text-sm font-semibold text-good lg:rounded-pill lg:bg-dark-2 lg:pl-5 lg:text-on-dark-muted"
        >
          <span className="inline-flex items-center gap-2">
            <Check size={16} aria-hidden />
            {t('promoApplied', { code: applied.code })}
          </span>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={t('promoRemove')}
            className="grid size-9 place-items-center rounded-pill hover:bg-white/10"
          >
            <X size={16} aria-hidden />
          </button>
        </p>
      ) : (
        <form
          onSubmit={submit}
          className="flex gap-2 lg:rounded-pill lg:bg-dark-2 lg:p-1.5 lg:pl-5"
        >
          <label htmlFor={id} className="sr-only">
            {t('promoLabel')}
          </label>
          <input
            id={id}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder={t('promoPlaceholder')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-msg` : undefined}
            data-testid="promo-input"
            className="h-12 min-w-0 flex-1 rounded-sm border border-line px-3.5 text-sm uppercase placeholder:normal-case aria-[invalid=true]:border-[#9A6700] focus:border-ink focus:outline-none lg:h-auto lg:border-0 lg:bg-transparent lg:px-0 lg:text-white lg:placeholder:text-subtle"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy || undefined}
            className="h-12 rounded-sm bg-canvas px-4 text-[13px] font-semibold disabled:opacity-60 lg:h-10 lg:rounded-pill lg:bg-white lg:px-[18px] lg:text-ink"
          >
            {t('promoApply')}
          </button>
        </form>
      )}
      <p
        id={`${id}-msg`}
        role="status"
        aria-live="polite"
        data-testid="promo-message"
        className={cn('text-[13px] font-medium text-warn lg:text-[#F2D27A]', !message && 'sr-only')}
      >
        {message}
      </p>
    </div>
  );
}

function RegionSelect({
  value,
  locale,
  onChange,
}: {
  value: string;
  locale: Locale;
  onChange: (region: string) => void;
}) {
  const t = useTranslations('cartPage');
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="text-muted lg:text-on-dark-muted">
        {t('region')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 min-w-0 max-w-[60%] rounded-sm border border-line bg-panel px-3 text-sm text-ink focus:border-ink focus:outline-none lg:border-dark-3 lg:bg-dark-2 lg:text-white"
      >
        {UZ_REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}

function EmptyCart({ tiles }: { tiles: CartViewProps['tiles'] }) {
  const t = useTranslations('cartPage');
  return (
    <section
      data-testid="cart-empty"
      className="flex flex-col gap-5 rounded-lg bg-panel p-6 lg:max-w-[720px] lg:rounded-[36px] lg:p-8"
    >
      <h2 className="text-[30px] leading-tight font-medium tracking-[-0.03em]">
        {t('emptyTitle')}
      </h2>
      <p className="text-[15px] leading-relaxed text-ink-2">{t('emptyText')}</p>
      {tiles.length ? (
        <ul className="grid grid-cols-2 gap-2.5">
          {tiles.map((c) => (
            <li key={c.slug}>
              <Link
                href={routes.category(c.slug)}
                className="relative block h-[150px] overflow-hidden rounded-[22px] bg-canvas"
              >
                {c.image ? (
                  <Image
                    src={c.image.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 340px, 50vw"
                    className="object-cover"
                  />
                ) : null}
                <span className="absolute bottom-2.5 left-2.5 rounded-pill bg-white px-3.5 py-2 text-[13px] font-semibold">
                  {c.name} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`${routes.home}#tanlash`}>{t('emptySelector')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={routes.catalog}>{t('emptyCatalog')}</Link>
        </Button>
      </div>
    </section>
  );
}

function CartSkeleton() {
  return (
    <div aria-busy className="flex flex-wrap gap-4">
      <div className="flex flex-[999_1_640px] flex-col gap-3 rounded-lg bg-panel p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-[88px] rounded-[16px] lg:size-[120px]" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-[420px] flex-[1_1_380px] rounded-xl" />
    </div>
  );
}
