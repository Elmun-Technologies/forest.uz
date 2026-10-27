'use client';

import type { AddressDto, CartDto, DeliveryOptionDto } from '@forest/contracts';
import { parseUzPhone, TASHKENT_DISTRICTS, UZ_REGIONS } from '@forest/contracts/core';
import {
  Button,
  cn,
  Field,
  Input,
  inputClasses,
  PhoneInput,
  Price,
  Skeleton,
  Textarea,
} from '@forest/ui';
import { Banknote, Clock, Gift, MapPin, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { readRegion, storeRegion, useDeliveryQuote } from '@/components/cart/use-quote';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { ClientApiError, clientApi, type CheckoutRequest } from '@/lib/client-api';
import { soum, uuid } from '@/lib/format';

type Method = CheckoutRequest['paymentMethod'];
type FieldKey =
  'name' | 'phone' | 'region' | 'district' | 'addressLine' | 'zoneKey' | 'paymentMethod' | 'offer';
type Errors = Partial<Record<FieldKey, string>>;

const FORM_ID = 'checkout-form';
/** Server error codes that mean "go back to the cart and fix it there". */
const CART_CODES = new Set(['CART_EMPTY', 'INSUFFICIENT_STOCK', 'OUT_OF_STOCK', 'IKPU_MISSING']);
const FIELD_ORDER: FieldKey[] = [
  'name',
  'phone',
  'region',
  'addressLine',
  'zoneKey',
  'paymentMethod',
  'offer',
];

export interface CheckoutFormProps {
  offerVersion: string;
  codEnabled: boolean;
  codMaxSoum: number | null;
  prefill: { name: string | null; phone: string | null; addresses: AddressDto[] };
}

/**
 * Single-page checkout (design: Checkout, Mobil-Checkout): contact → delivery → payment.
 * POST /checkout/orders with an Idempotency-Key that stays the same while the payload does,
 * so a retried submit (double tap, flaky network) can never create two orders.
 */
export function CheckoutForm({ offerVersion, codEnabled, codMaxSoum, prefill }: CheckoutFormProps) {
  const t = useTranslations('checkout');
  const tc = useTranslations('common');
  const locale = useLocale() as 'uz' | 'ru';
  const router = useRouter();
  const { cart, status, setCart, refresh } = useCart();

  const defaultAddress = prefill.addresses.find((a) => a.isDefault) ?? prefill.addresses[0];
  const [name, setName] = useState(prefill.name ?? '');
  const [phone, setPhone] = useState(prefill.phone?.replace(/^\+998/, '') ?? '');
  const [region, setRegion] = useState(defaultAddress?.region ?? 'tashkent_city');
  const [district, setDistrict] = useState(defaultAddress?.district ?? '');
  const [addressLine, setAddressLine] = useState(defaultAddress?.line ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [zoneKey, setZoneKey] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('PAYME');
  const [comment, setComment] = useState('');
  const [offer, setOffer] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<{ message: string; toCart: boolean } | null>(null);
  const [submitting, setSubmitting] = useState<false | 'sending' | 'redirecting'>(false);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});

  // Region chosen on the cart page wins over the account default only when there is none.
  useEffect(() => {
    const saved = readRegion();
    if (!defaultAddress && saved && UZ_REGIONS.some((r) => r.code === saved)) setRegion(saved);
  }, [defaultAddress]);

  const isCity = region === 'tashkent_city';
  const quote = useDeliveryQuote(
    region,
    isCity ? district || null : null,
    cart?.totals.subtotalSoum,
    coords,
  );

  // Keep the chosen option if still offered, otherwise preselect the fastest (first) one.
  useEffect(() => {
    if (quote.status !== 'ready') return;
    setZoneKey((cur) =>
      cur && quote.options.some((o) => o.zoneKey === cur)
        ? cur
        : (quote.options[0]?.zoneKey ?? null),
    );
  }, [quote]);

  // Price shipping for the chosen zone (totals, free-shipping threshold, COD limit).
  // With the map pin, a live-quoted zone prices the totals exactly like the option and the order.
  useEffect(() => {
    if (!zoneKey) return;
    let live = true;
    clientApi.cart
      .get(zoneKey, coords)
      .then((dto) => live && setCart(dto))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [zoneKey, coords, setCart]);

  const total = cart?.totals.totalSoum ?? 0;
  const codOverLimit = codMaxSoum !== null && total > codMaxSoum;
  useEffect(() => {
    if (method === 'COD' && (codOverLimit || !codEnabled)) setMethod('PAYME');
  }, [method, codOverLimit, codEnabled]);

  if (status === 'loading' && !cart) return <CheckoutSkeleton />;
  if (!cart || cart.lines.length === 0) {
    return (
      <section className="mx-auto flex max-w-[560px] flex-col items-start gap-4 rounded-lg bg-panel p-8">
        <h1 className="text-h3 font-medium">{t('emptyTitle')}</h1>
        <p className="text-muted">{t('emptyText')}</p>
        <Button asChild>
          <Link href={routes.catalog}>{t('toCatalog')}</Link>
        </Button>
      </section>
    );
  }

  const option = quote.options.find((o) => o.zoneKey === zoneKey) ?? null;
  const methods: Method[] = codEnabled ? ['PAYME', 'CLICK', 'COD'] : ['PAYME', 'CLICK'];

  function validate(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = t('errors.name');
    const p = parseUzPhone(phone);
    if (!p.ok) e.phone = tc(`phoneErrors.${p.error}`);
    if (!region) e.region = t('errors.region');
    if (addressLine.trim().length < 5) e.addressLine = t('errors.address');
    if (!zoneKey) e.zoneKey = t('errors.zone');
    if (!offer) e.offer = t('errors.offer');
    return e;
  }

  function focusFirst(e: Errors) {
    const first = FIELD_ORDER.find((k) => e[k]);
    if (first) fieldRefs.current[first]?.focus();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      setFormError({ message: t('errors.summary'), toCart: false });
      focusFirst(found);
      return;
    }
    const body: CheckoutRequest = {
      name: name.trim(),
      phone: `+998${phone}`,
      region,
      district: district || null,
      addressLine: addressLine.trim(),
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      zoneKey: zoneKey!,
      paymentMethod: method,
      comment: comment.trim() || null,
      offerVersion,
      consents: { smsMarketing: marketing, telegram: false },
    };
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serialized)
      attempt.current = { key: uuid(), body: serialized };

    setSubmitting('sending');
    try {
      const result = await clientApi.checkout.place(body, attempt.current.key);
      storeRegion(region);
      if (result.next.type === 'redirect') {
        setSubmitting('redirecting');
        window.location.assign(result.next.url);
        return;
      }
      await refresh();
      router.push(`/buyurtma/${result.publicId}`);
    } catch (err) {
      setSubmitting(false);
      if (!(err instanceof ClientApiError)) {
        setFormError({ message: t('errors.generic'), toCart: false });
        return;
      }
      if (err.code === 'NETWORK') {
        // Same payload → same key on the next tap, so a request that did reach us is not repeated.
        setFormError({ message: t('errors.network'), toCart: false });
        return;
      }
      const field = mapField(err.field);
      if (field) {
        const next = { [field]: err.message };
        setErrors(next);
        focusFirst(next);
      }
      const toCart = CART_CODES.has(err.code) || err.code.startsWith('PROMO_');
      setFormError({
        message: err.status >= 500 ? t('errors.generic') : err.message,
        toCart,
      });
      if (toCart) void refresh();
    }
  }

  const shippingText = (c: CartDto) =>
    c.totals.shippingSoum === null
      ? '—'
      : c.totals.shippingSoum === 0
        ? tc('freeShipping')
        : soum(c.totals.shippingSoum, locale, false);
  const summaryLine = (c: CartDto) =>
    c.totals.discountSoum > 0
      ? t('summaryLine', {
          items: soum(c.totals.subtotalSoum, locale, false),
          discount: soum(c.totals.discountSoum, locale, false),
          shipping: shippingText(c),
        })
      : t('summaryLineNoDiscount', {
          items: soum(c.totals.subtotalSoum, locale, false),
          shipping: shippingText(c),
        });
  const totalText = soum(total, locale);
  const cta = submitting ? t(submitting === 'redirecting' ? 'redirecting' : 'submitting') : null;

  return (
    <>
      {/* Mobile compact header */}
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-canvas px-4 py-3 lg:hidden">
        <Link
          href={routes.cart}
          aria-label={t('backToCart')}
          className="grid size-11 place-items-center rounded-pill bg-panel"
        >
          <BackIcon />
        </Link>
        <h1 className="flex-1 text-center text-base font-semibold">{t('title')}</h1>
        <span className="grid size-11 place-items-center text-forest" title={tc('secure')}>
          <LockIcon />
          <span className="sr-only">{tc('secure')}</span>
        </span>
      </header>

      <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-2.5 px-3 pb-6 lg:gap-4 lg:px-6 lg:pb-16">
        <form
          id={FORM_ID}
          noValidate
          onSubmit={submit}
          className="flex min-w-0 flex-[999_1_640px] flex-col gap-2.5 lg:gap-4"
        >
          <MobileSummary cart={cart} locale={locale} />
          <div className="hidden flex-wrap items-end justify-between gap-4 rounded-xl bg-panel px-12 py-10 lg:flex">
            <h1 className="text-[72px] leading-[0.95] font-medium tracking-[-0.05em]">
              {t('title')}
            </h1>
            <Link href={routes.cart} className="text-sm font-medium underline underline-offset-2">
              ← {t('backToCart')}
            </Link>
          </div>

          <Section n={1} title={t('contact')} short={t('contactShort')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
              <Field label={t('name')} error={errors.name} className="sm:flex-[1_1_260px]">
                {(p) => (
                  <Input
                    {...p}
                    ref={(el) => {
                      fieldRefs.current.name = el;
                    }}
                    name="name"
                    autoComplete="name"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('phone')}
                error={errors.phone}
                className="max-sm:order-first sm:flex-[1_1_260px]"
              >
                {(p) => (
                  <PhoneInput
                    {...p}
                    ref={(el) => {
                      fieldRefs.current.phone = el;
                    }}
                    name="phone"
                    value={phone}
                    onValueChange={setPhone}
                    data-testid="checkout-phone"
                  />
                )}
              </Field>
            </div>
            <p className="hidden text-[13px] text-muted sm:block">{t('contactHint')}</p>
          </Section>

          <Section n={2} title={t('delivery')} short={t('delivery')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
              <Field label={t('region')} error={errors.region} className="sm:flex-[1_1_260px]">
                {(p) => (
                  <select
                    {...p}
                    ref={(el) => {
                      fieldRefs.current.region = el;
                    }}
                    name="region"
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      setDistrict('');
                    }}
                    className={cn(inputClasses, 'appearance-auto')}
                  >
                    {UZ_REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r[locale]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label={isCity ? t('district') : t('districtOptional')}
                error={errors.district}
                className="sm:flex-[1_1_260px]"
              >
                {(p) =>
                  isCity ? (
                    <select
                      {...p}
                      name="district"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className={cn(inputClasses, 'appearance-auto')}
                    >
                      <option value="">{t('districtPlaceholder')}</option>
                      {TASHKENT_DISTRICTS.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d[locale]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      {...p}
                      name="district"
                      value={district}
                      maxLength={80}
                      autoComplete="address-level3"
                      onChange={(e) => setDistrict(e.target.value)}
                    />
                  )
                }
              </Field>
            </div>
            {prefill.addresses.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted">{t('savedAddresses')}:</span>
                {prefill.addresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setRegion(a.region);
                      setDistrict(a.district ?? '');
                      setAddressLine(a.line);
                    }}
                    className="min-h-9 rounded-pill bg-canvas px-3.5 font-semibold hover:bg-sage"
                  >
                    {a.label ?? a.line.slice(0, 24)}
                  </button>
                ))}
              </div>
            ) : null}
            <Field label={t('address')} error={errors.addressLine}>
              {(p) => (
                <Input
                  {...p}
                  ref={(el) => {
                    fieldRefs.current.addressLine = el;
                  }}
                  name="addressLine"
                  autoComplete="street-address"
                  placeholder={t('addressPlaceholder')}
                  value={addressLine}
                  maxLength={300}
                  onChange={(e) => setAddressLine(e.target.value)}
                  data-private
                />
              )}
            </Field>
            <GeoButton
              state={geo}
              onLocate={() => {
                if (!('geolocation' in navigator)) return setGeo('failed');
                setGeo('busy');
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    setGeo('done');
                  },
                  () => setGeo('failed'),
                  { timeout: 10_000, maximumAge: 60_000 },
                );
              }}
            />

            <fieldset
              className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3"
              aria-describedby={errors.zoneKey ? 'zone-error' : undefined}
              ref={(el) => {
                fieldRefs.current.zoneKey = el;
              }}
              tabIndex={-1}
            >
              <legend className="sr-only">{t('delivery')}</legend>
              {quote.status === 'loading' && quote.options.length === 0 ? (
                <p className="text-sm text-muted" aria-live="polite">
                  {t('quoting')}
                </p>
              ) : null}
              {quote.options.map((o) => (
                <DeliveryCard
                  key={o.zoneKey}
                  option={o}
                  checked={o.zoneKey === zoneKey}
                  onSelect={() => setZoneKey(o.zoneKey)}
                  priceSoum={
                    o.zoneKey === zoneKey && cart.totals.shippingSoum !== null
                      ? cart.totals.shippingSoum
                      : o.priceSoum
                  }
                />
              ))}
              {quote.status === 'ready' && quote.options.length === 0 ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {tc('generic')}
                </p>
              ) : null}
            </fieldset>
            {errors.zoneKey ? (
              <p id="zone-error" role="alert" className="text-[13px] font-medium text-danger">
                {errors.zoneKey}
              </p>
            ) : null}
            {option ? (
              <p className="hidden items-center gap-3 rounded-[18px] bg-canvas px-[18px] py-3.5 text-sm sm:flex">
                <Clock size={20} className="shrink-0 text-forest" aria-hidden />
                {t(`carrierInfo.${option.carrier}`, { eta: option.etaLabel })}
              </p>
            ) : null}
          </Section>

          <Section n={3} title={t('payment')} short={t('paymentShort')}>
            <fieldset
              ref={(el) => {
                fieldRefs.current.paymentMethod = el;
              }}
              tabIndex={-1}
              className="grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] sm:gap-3"
              aria-describedby={errors.paymentMethod ? 'pay-error' : undefined}
            >
              <legend className="sr-only">{t('payment')}</legend>
              {methods.map((m) => (
                <PaymentCard
                  key={m}
                  method={m}
                  checked={method === m}
                  disabled={m === 'COD' && codOverLimit}
                  onSelect={() => setMethod(m)}
                />
              ))}
            </fieldset>
            {codEnabled && codOverLimit && codMaxSoum !== null ? (
              <p className="text-[13px] text-muted">
                {t('codLimit', { amount: soum(codMaxSoum, locale) })}
              </p>
            ) : null}
            {errors.paymentMethod ? (
              <p id="pay-error" role="alert" className="text-[13px] font-medium text-danger">
                {errors.paymentMethod}
              </p>
            ) : null}
            <Field label={t('comment')}>
              {(p) => (
                <Textarea
                  {...p}
                  name="comment"
                  value={comment}
                  maxLength={500}
                  placeholder={t('commentPlaceholder')}
                  onChange={(e) => setComment(e.target.value)}
                  className="min-h-[90px] resize-y"
                />
              )}
            </Field>
            <div className="flex flex-col gap-2.5">
              <Check
                checked={offer}
                onChange={setOffer}
                testId="consent-offer"
                error={errors.offer}
                inputRef={(el) => {
                  fieldRefs.current.offer = el;
                }}
              >
                {t.rich('consentOffer', {
                  offer: (chunks) => (
                    <Link href={routes.offer} target="_blank" className="font-semibold underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </Check>
              <Check checked={marketing} onChange={setMarketing} testId="consent-marketing">
                {t('consentMarketing')}
              </Check>
            </div>
          </Section>
          {cart.promo?.status === 'applied' ? (
            <p className="flex items-center gap-2.5 rounded-md bg-sage px-[18px] py-3.5 text-[13px] lg:hidden">
              <Gift size={18} aria-hidden />
              <span>
                {t.rich('promo', {
                  code: cart.promo.code,
                  amount: soum(cart.totals.discountSoum, locale),
                  b: (c) => <b>{c}</b>,
                })}
              </span>
            </p>
          ) : null}
        </form>

        <aside className="hidden min-w-0 flex-[1_1_400px] flex-col gap-4 lg:flex">
          <div className="flex flex-col gap-[18px] rounded-xl bg-panel p-8">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{t('summary')}</h2>
            <ul className="flex flex-col gap-[18px]">
              {cart.lines.map((l) => (
                <li key={l.variantId} className="flex items-center gap-3.5">
                  <span className="relative shrink-0">
                    <span className="relative block size-16 overflow-hidden rounded-[16px] bg-canvas">
                      {l.image ? (
                        <Image
                          src={l.image.url}
                          alt=""
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="absolute -top-1.5 -right-1.5 grid size-[22px] place-items-center rounded-pill bg-ink text-[11px] text-white">
                      <span className="sr-only">{t('qtyBadge', { count: l.qty })}</span>
                      <span aria-hidden>{l.qty}</span>
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="block font-semibold">{l.name}</b>
                    <span className="text-muted">{l.variantLabel}</span>
                  </span>
                  <Price
                    soum={l.lineTotalSoum}
                    locale={locale}
                    withCurrency={false}
                    className="text-sm font-semibold"
                  />
                </li>
              ))}
            </ul>
            <Totals cart={cart} locale={locale} />
            <SubmitError error={formError} />
            <Button
              type="submit"
              form={FORM_ID}
              size="lg"
              block
              loading={Boolean(submitting)}
              data-testid="place-order"
              data-track="place_order"
              className="h-auto min-h-16 py-4 text-base whitespace-normal"
            >
              {cta ?? (method === 'COD' ? t('cta.COD') : t(`cta.${method}`, { total: totalText }))}
            </Button>
            <p className="text-center text-xs leading-normal text-muted">
              {method === 'COD' ? t('ctaNoteCod') : t('ctaNoteOnline')}
            </p>
          </div>
          <p className="flex items-start gap-3.5 rounded-[32px] bg-sage px-7 py-6 text-sm leading-[1.55]">
            <ShieldCheck size={22} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {t.rich('privacyNote', {
                offer: (chunks) => (
                  <Link href={routes.offer} className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </p>
        </aside>
      </div>

      {/* Mobile sticky submit bar */}
      <div className="sticky bottom-0 z-30 flex flex-col gap-2.5 border-t border-line bg-panel px-3 pt-3 pb-4 lg:hidden">
        <SubmitError error={formError} />
        <p className="text-[13px] text-muted">{summaryLine(cart)}</p>
        <Button
          type="submit"
          form={FORM_ID}
          size="lg"
          block
          loading={Boolean(submitting)}
          data-testid="place-order-mobile"
          data-track="place_order"
          className="h-14 text-base"
        >
          {cta ?? t(`ctaMobile.${method}`, { total: totalText })}
        </Button>
      </div>
    </>
  );
}

function mapField(field: string | undefined): FieldKey | null {
  switch (field) {
    case 'name':
    case 'phone':
    case 'region':
    case 'district':
    case 'addressLine':
    case 'zoneKey':
    case 'paymentMethod':
      return field;
    case 'offerVersion':
      return 'offer';
    default:
      return null;
  }
}

function Section({
  n,
  title,
  short,
  children,
}: {
  n: number;
  title: string;
  short: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-[24px] bg-panel p-[18px] lg:gap-5 lg:rounded-[32px] lg:px-10 lg:py-9">
      <legend className="float-left mb-1 flex items-center gap-3.5 text-[17px] font-bold lg:text-2xl lg:font-semibold lg:tracking-[-0.02em]">
        <span
          aria-hidden
          className="hidden size-10 place-items-center rounded-pill bg-ink text-[15px] text-white lg:grid"
        >
          {n}
        </span>
        <span className="lg:hidden">
          {n} · {short}
        </span>
        <span className="hidden lg:inline">{title}</span>
      </legend>
      <div className="clear-both flex flex-col gap-3 lg:gap-5">{children}</div>
    </fieldset>
  );
}

function DeliveryCard({
  option,
  checked,
  onSelect,
  priceSoum,
}: {
  option: DeliveryOptionDto;
  checked: boolean;
  onSelect: () => void;
  priceSoum: number;
}) {
  const t = useTranslations('checkout');
  const tc = useTranslations('common');
  const locale = useLocale() as 'uz' | 'ru';
  const carrier = option.carrier === 'PICKUP' ? null : option.carrier;
  return (
    <label
      data-testid={`delivery-${option.zoneKey}`}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-[16px] border p-3 transition-colors sm:flex-[1_1_280px] sm:flex-col sm:items-start sm:gap-1 sm:rounded-[22px] sm:px-5 sm:py-[18px]',
        'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest',
        checked ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-ink',
      )}
    >
      <input
        type="radio"
        name="zoneKey"
        value={option.zoneKey}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="flex shrink-0 items-center sm:w-full sm:justify-between sm:gap-2">
        {carrier ? (
          <span className="inline-flex h-9 items-center rounded-xs border border-[#E3E6DD] bg-white px-2.5 sm:h-11 sm:px-3.5">
            <Logo
              src={logos.light[carrier]}
              alt={logoAlt[carrier]}
              className={carrier === 'YANDEX' ? 'h-3.5 sm:h-4' : 'h-[26px] sm:h-8'}
            />
          </span>
        ) : null}
        <b className="hidden font-semibold sm:inline">
          {priceSoum === 0 ? tc('freeShipping') : <Price soum={priceSoum} locale={locale} />}
        </b>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:mt-1.5">
        <b className="text-sm sm:text-[17px]">{tc(`carrier.${option.carrier}`)}</b>
        <span className="text-xs opacity-80 sm:text-[13px]">
          {t('zoneNote', { zone: option.name, eta: option.etaLabel })}
        </span>
      </span>
      <b className="text-[13px] sm:hidden">
        {priceSoum === 0 ? (
          tc('freeShipping')
        ) : (
          <Price soum={priceSoum} locale={locale} withCurrency={false} />
        )}
      </b>
    </label>
  );
}

function PaymentCard({
  method,
  checked,
  disabled,
  onSelect,
}: {
  method: Method;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('checkout');
  return (
    <label
      data-testid={`pay-${method}`}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-[16px] border p-3 transition-colors sm:flex-col sm:items-start sm:gap-2.5 sm:rounded-[22px] sm:p-[22px]',
        'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest',
        checked
          ? 'border-[1.5px] border-ink bg-canvas sm:border sm:bg-ink sm:text-white'
          : 'border-line bg-panel hover:border-ink',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="radio"
        name="paymentMethod"
        value={method}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      {/* Mobile radio dot */}
      <span
        aria-hidden
        className={cn(
          'size-[22px] shrink-0 rounded-pill sm:hidden',
          checked ? 'border-[6px] border-ink' : 'border-2 border-[#B9BEB2]',
        )}
      />
      <span className="hidden h-11 items-center rounded-xs border border-[#E3E6DD] bg-white px-3.5 sm:inline-flex">
        {method === 'COD' ? (
          <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-[0.04em] text-ink uppercase">
            <Banknote size={18} className="text-forest" aria-hidden />
            {t('methods.COD.badge')}
          </span>
        ) : (
          <Logo
            src={logos.light[method]}
            alt=""
            className={method === 'PAYME' ? 'h-6' : 'h-[22px]'}
          />
        )}
      </span>
      <b className="flex-1 text-sm font-semibold sm:flex-none sm:text-[17px] sm:font-bold">
        <span className="sm:hidden">
          {method === 'COD' ? t('methods.COD.mobile') : t(`methods.${method}.name`)}
        </span>
        <span className="hidden sm:inline">{t(`methods.${method}.name`)}</span>
      </b>
      <span className="hidden text-[13px] opacity-80 sm:block">{t(`methods.${method}.note`)}</span>
      {method === 'COD' ? null : (
        <Logo src={logos.light[method]} alt="" className="h-4 sm:hidden" />
      )}
    </label>
  );
}

function Check({
  checked,
  onChange,
  children,
  error,
  testId,
  inputRef,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  error?: string;
  testId: string;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const id = `chk-${testId}`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-snug"
      >
        <input
          id={id}
          ref={inputRef}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid={testId}
          className="mt-0.5 size-5 shrink-0 accent-forest"
        />
        <span>{children}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GeoButton({
  state,
  onLocate,
}: {
  state: 'idle' | 'busy' | 'done' | 'failed';
  onLocate: () => void;
}) {
  const t = useTranslations('checkout');
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onLocate}
        aria-busy={state === 'busy' || undefined}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-[#B9BEB2] text-sm font-medium hover:border-ink sm:self-start sm:px-5"
      >
        <MapPin size={16} className="text-forest" aria-hidden />
        {t('locate')}
      </button>
      <p aria-live="polite" className="text-xs text-muted">
        {state === 'done' ? t('located') : state === 'failed' ? t('locateFailed') : null}
      </p>
    </div>
  );
}

function ShippingValue({ cart, locale }: { cart: CartDto; locale: 'uz' | 'ru' }) {
  const tc = useTranslations('common');
  const s = cart.totals.shippingSoum;
  if (s === null) return <>—</>;
  return s === 0 ? <>{tc('freeShipping')}</> : <Price soum={s} locale={locale} />;
}

function Totals({ cart, locale }: { cart: CartDto; locale: 'uz' | 'ru' }) {
  const t = useTranslations('checkout');
  const row = 'flex justify-between';
  return (
    <dl className="tabular flex flex-col gap-2.5 border-t border-line pt-[18px] text-[15px]">
      <div className={row}>
        <dt className="text-muted">{t('items')}</dt>
        <dd>
          <Price soum={cart.totals.subtotalSoum} locale={locale} />
        </dd>
      </div>
      {cart.totals.discountSoum > 0 ? (
        <div className={cn(row, 'font-semibold text-good')}>
          <dt>
            {t('discount')}
            {cart.promo?.status === 'applied' ? ` · ${cart.promo.code}` : null}
          </dt>
          <dd>
            −<Price soum={cart.totals.discountSoum} locale={locale} />
          </dd>
        </div>
      ) : null}
      <div className={row}>
        <dt className="text-muted">{t('shipping')}</dt>
        <dd>
          <ShippingValue cart={cart} locale={locale} />
        </dd>
      </div>
      <div className={cn(row, 'items-baseline pt-2')}>
        <dt className="text-base font-bold">{t('total')}</dt>
        <dd data-testid="checkout-total">
          <Price
            soum={cart.totals.totalSoum}
            locale={locale}
            className="text-[32px] font-semibold tracking-[-0.03em]"
          />
        </dd>
      </div>
    </dl>
  );
}

function MobileSummary({ cart, locale }: { cart: CartDto; locale: 'uz' | 'ru' }) {
  const t = useTranslations('checkout');
  return (
    <details className="group rounded-[24px] bg-panel px-[18px] py-4 lg:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2.5">
          <span className="inline-flex">
            {cart.lines.slice(0, 3).map((l, i) =>
              l.image ? (
                <span
                  key={l.variantId}
                  className={cn(
                    'relative size-8 overflow-hidden rounded-pill border-2 border-white',
                    i > 0 && '-ml-2.5',
                  )}
                >
                  <Image src={l.image.url} alt="" fill sizes="32px" className="object-cover" />
                </span>
              ) : null,
            )}
          </span>
          {t('itemsCount', { count: cart.totals.itemsCount })}
        </span>
        <Price soum={cart.totals.totalSoum} locale={locale} />
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-[13px] text-muted">
        {cart.lines.map((l) => (
          <li key={l.variantId}>
            {l.name} {l.variantLabel} × {l.qty} ·{' '}
            <Price soum={l.lineTotalSoum} locale={locale} withCurrency={false} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function SubmitError({ error }: { error: { message: string; toCart: boolean } | null }) {
  const t = useTranslations('checkout');
  return (
    <div role="alert" aria-live="assertive" data-testid="checkout-error">
      {error ? (
        <p className="rounded-sm bg-critical-bg px-4 py-3 text-[13px] font-medium text-critical">
          {error.message}{' '}
          {error.toCart ? (
            <Link href={routes.cart} className="font-semibold underline">
              {t('errors.toCart')}
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div aria-busy className="mx-auto flex max-w-[1440px] flex-wrap gap-4 px-3 lg:px-6">
      <div className="flex flex-[999_1_640px] flex-col gap-4">
        <Skeleton className="h-[160px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-[32px]" />
        <Skeleton className="h-[320px] rounded-[32px]" />
      </div>
      <Skeleton className="h-[520px] flex-[1_1_400px] rounded-xl" />
    </div>
  );
}

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
