import type { Locale, OrderPublicDto, OrderTimelineStepDto, TrackingDto } from '@forest/contracts';
import { cn, Price } from '@forest/ui';
import { Check, Send } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ClientMessages } from '@/components/client-messages';
import { AutoRefresh } from '@/components/order/auto-refresh';
import { BranchCard, CourierCard } from '@/components/order/carrier-parts';
import { needsPayment, OrderItems, PrepVideo, trackingPath } from '@/components/order/order-parts';
import { RetryPayment } from '@/components/order/retry-payment';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { ApiError, apiGet, apiGetOptional } from '@/lib/api';
import { CARRIER_ACTIVE, trackingToken, waitingBranch } from '@/lib/carrier';
import { getHomeContent } from '@/lib/data';
import { formatWhen, placeName } from '@/lib/format';

// Per-request page: the [locale] layout's generateStaticParams would otherwise mark it static,
// and its cookie/searchParams read would fail at runtime (DYNAMIC_SERVER_USAGE).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: Locale; publicId: string }> };

async function loadOrder(publicId: string, locale: Locale): Promise<OrderPublicDto> {
  try {
    return await apiGet<OrderPublicDto>(`/orders/${encodeURIComponent(publicId)}`, locale, {
      personal: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: 'order' });
  const o = await loadOrder(publicId, locale);
  // Personal page behind an unguessable id: never indexed, never shared with a canonical.
  return { title: t('metaTitle', { number: o.number }), robots: { index: false, follow: false } };
}

/** "Bugun, 13:26" → "bugun, 13:26" inside a sentence. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const label = 'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase';

/** `/{locale}/buyurtma/[publicId]` — order received (design: Buyurtma; Holatlar · 1). */
export default async function OrderPage({ params }: Props) {
  const { locale, publicId } = await params;
  setRequestLocale(locale);
  const [o, home, t, tc, tt] = await Promise.all([
    loadOrder(publicId, locale),
    getHomeContent(locale),
    getTranslations('order'),
    getTranslations('common'),
    getTranslations('track'),
  ]);
  // Courier/branch details live in the tracking read model; ask for it only once a carrier is
  // involved (same owner rule: full courier number only for this customer/browser).
  const token = trackingToken(o);
  const tracking =
    token && CARRIER_ACTIVE.has(o.deliveryStatus)
      ? await apiGetOptional<TrackingDto>(`/track/${encodeURIComponent(token)}`, locale, {
          personal: true,
        })
      : null;
  const branch = tracking ? waitingBranch(tracking) : null;
  const online = o.paymentMethod !== 'COD';
  const pay = needsPayment(o);
  const failed = o.paymentStatus === 'FAILED';
  const expired = o.paymentStatus === 'EXPIRED' || o.status === 'CANCELLED';
  const masked = o.contactPhone.includes('*');
  const carrier = o.carrier === 'PICKUP' ? null : o.carrier;
  const when = (iso: string) => formatWhen(tc, iso);

  const lead = expired
    ? null
    : o.paymentStatus === 'PAID'
      ? `${t('leadPaid', { method: tc(`payment.${o.paymentMethod}`) })} ${t(`leadCarrier.${o.carrier}`)}`
      : failed
        ? t('leadFailed')
        : online
          ? t('leadPending')
          : `${t('leadCod')} ${t(`leadCarrier.${o.carrier}`)}`;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-4 lg:px-6 lg:pt-2">
      {online && o.paymentStatus === 'PENDING' && o.status === 'NEW' ? <AutoRefresh /> : null}
      <section className="flex flex-wrap gap-2.5 lg:gap-4">
        <div className="relative flex min-h-[420px] min-w-0 flex-[3_1_640px] flex-col justify-between gap-10 overflow-hidden rounded-lg bg-forest p-7 text-white lg:min-h-[520px] lg:rounded-xl lg:p-14">
          <span
            aria-hidden
            className="absolute -top-20 -right-20 size-[460px] rounded-pill bg-sage/25"
          />
          <span className="relative grid size-16 place-items-center rounded-pill bg-white text-forest lg:size-[88px]">
            <Check size={36} strokeWidth={2.4} aria-hidden />
          </span>
          <div className="relative flex flex-col gap-5">
            <h1 className="text-[44px] leading-[0.95] font-medium tracking-[-0.05em] lg:text-[80px]">
              {expired ? (
                t('cancelledTitle')
              ) : (
                <>
                  {t('thanks', { name: o.contactName })}
                  <br />
                  {t('received')}
                </>
              )}
            </h1>
            <p
              className="max-w-[520px] text-[17px] leading-relaxed text-[#E1E7DA]"
              data-testid="order-lead"
            >
              {expired ? t('expiredText') : lead}
            </p>
          </div>
          <div className="relative flex flex-wrap gap-2.5">
            <span
              data-testid="order-number"
              className="tabular rounded-pill bg-white px-5 py-3 text-[15px] font-semibold text-ink"
            >
              {t('number', { number: o.number })}
            </span>
            {o.telegramDeepLink ? (
              <a
                href={o.telegramDeepLink}
                data-track="telegram_click"
                className="inline-flex min-h-12 items-center gap-2.5 rounded-pill border-[1.5px] border-white/80 px-5 text-[15px] font-medium"
              >
                <Send size={16} aria-hidden />
                {t('trackTelegram')}
              </a>
            ) : null}
            <a
              href={trackingPath(o)}
              data-testid="tracking-link"
              className="inline-flex min-h-12 items-center rounded-pill border-[1.5px] border-white/80 px-5 text-[15px] font-medium"
            >
              {t('trackPage')}
            </a>
          </div>
        </div>

        <div className="flex min-w-0 flex-[2_1_400px] flex-col gap-2.5 lg:gap-4">
          {pay && o.reservationExpiresAt ? (
            <ClientMessages namespaces={['order']}>
              <RetryPayment
                publicId={o.publicId}
                number={o.number}
                method={o.paymentMethod === 'CLICK' ? 'CLICK' : 'PAYME'}
                failed={failed}
                until={lowerFirst(when(o.reservationExpiresAt))}
              />
            </ClientMessages>
          ) : null}
          {expired ? (
            <section className="flex flex-col items-start gap-4 rounded-lg bg-panel p-7 lg:rounded-xl lg:p-10">
              <h2 className="text-[22px] font-semibold">{t('expiredTitle')}</h2>
              <p className="text-muted">{t('cancelledText')}</p>
              <Link
                href={routes.catalog}
                className="rounded-pill bg-ink px-6 py-3.5 text-sm font-semibold text-white"
              >
                {t('toCatalog')}
              </Link>
            </section>
          ) : (
            <section
              aria-labelledby="status-title"
              className="flex flex-1 flex-col gap-1 rounded-lg bg-panel p-7 lg:rounded-xl lg:p-10"
            >
              <h2 id="status-title" className="mb-5 text-[22px] font-semibold tracking-[-0.02em]">
                {t('status')}
              </h2>
              <ol data-testid="order-timeline">
                {o.timeline.map((s, i) => (
                  <TimelineStep
                    key={s.key}
                    step={s}
                    last={i === o.timeline.length - 1}
                    nextDone={o.timeline[i + 1]?.state === 'done'}
                    sub={stepSub(s)}
                    title={
                      s.key === 'PAID' && s.state === 'done' && online
                        ? t('stepPaidVia', {
                            label: s.label,
                            method: tc(`payment.${o.paymentMethod}`),
                          })
                        : s.label
                    }
                    carrier={s.key === 'SHIPPED' && s.state !== 'done' ? carrier : null}
                  />
                ))}
              </ol>
              {tracking && (tracking.courier || tracking.carrierRef || branch) ? (
                <div
                  data-testid="order-carrier"
                  className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
                >
                  {tracking.courier ? (
                    <CourierCard
                      courier={tracking.courier}
                      carrier={tracking.carrier}
                      locale={locale}
                      loginNext={`/buyurtma/${o.publicId}`}
                      compact
                    />
                  ) : null}
                  {branch ? <BranchCard branch={branch} /> : null}
                  {tracking.carrierRef ? (
                    <span className="text-[13px] text-muted">
                      {tracking.carrier === 'BTS'
                        ? tt('trackNumber', { ref: tracking.carrierRef })
                        : tt('carrierRef', { ref: tracking.carrierRef })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </section>
          )}
        </div>
      </section>

      <section className="flex flex-wrap gap-2.5 lg:gap-4">
        <div className="flex flex-[1_1_300px] flex-col gap-2.5 rounded-lg bg-panel p-6 lg:rounded-[32px] lg:p-8">
          <span className={label}>{t('addressTitle')}</span>
          <b className="text-lg font-semibold">{placeName(o.address, locale)}</b>
          {o.address.line ? <span className="text-[15px] text-muted">{o.address.line}</span> : null}
          {carrier ? (
            <span className="mt-1 inline-flex items-center gap-2.5 text-[13px] text-muted">
              <Logo
                src={logos.light[carrier]}
                alt={logoAlt[carrier]}
                className={carrier === 'YANDEX' ? 'h-3.5' : 'h-5'}
              />
              {tc(`carrier.${carrier}`)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-[1_1_300px] flex-col gap-2.5 rounded-lg bg-panel p-6 lg:rounded-[32px] lg:p-8">
          <span className={label}>{t('recipient')}</span>
          <b className="text-lg font-semibold">{o.contactName}</b>
          <span className="tabular text-[15px] text-muted" data-private>
            {o.contactPhone}
          </span>
          {masked ? (
            <p className="text-[13px] text-muted">
              {t.rich('masked', {
                login: (c) => (
                  <Link
                    href={`${routes.login}?next=${encodeURIComponent(`/buyurtma/${o.publicId}`)}`}
                    className="font-semibold text-ink underline"
                  >
                    {c}
                  </Link>
                ),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-[1_1_300px] flex-col gap-2.5 rounded-lg bg-panel p-6 lg:rounded-[32px] lg:p-8">
          <span className={label}>{t('payment')}</span>
          <span className="flex items-center gap-3">
            <Price soum={o.totalSoum} locale={locale} className="text-lg font-semibold" />
            {o.paymentMethod === 'COD' ? (
              <span className="text-sm font-semibold">{tc('payment.COD')}</span>
            ) : (
              <Logo
                src={logos.light[o.paymentMethod]}
                alt={logoAlt[o.paymentMethod]}
                className="h-5"
              />
            )}
          </span>
          <span
            data-testid="payment-status"
            className={cn(
              'text-sm font-semibold',
              o.paymentStatus === 'PAID'
                ? 'text-good'
                : o.paymentStatus === 'FAILED' || o.paymentStatus === 'EXPIRED'
                  ? 'text-critical'
                  : 'text-muted',
            )}
          >
            {t(`paymentStatus.${o.paymentStatus}`)}
          </span>
          {o.fiscalReceiptUrl ? (
            <a
              href={o.fiscalReceiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[15px] text-muted underline"
            >
              {t('receipt')}
            </a>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-lg bg-panel p-6 lg:rounded-xl lg:px-12 lg:py-10">
        <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em]">
          {t('contents', { count: o.items.reduce((a, i) => a + i.qty, 0) })}
        </h2>
        <OrderItems order={o} locale={locale} />
        <dl className="tabular flex flex-col gap-2 border-t border-line pt-4 text-[15px] sm:ml-auto sm:min-w-[320px]">
          <div className="flex justify-between gap-6">
            <dt className="text-muted">{t('summaryItems')}</dt>
            <dd>
              <Price soum={o.subtotalSoum} locale={locale} />
            </dd>
          </div>
          {o.discountSoum > 0 ? (
            <div className="flex justify-between gap-6 text-good">
              <dt>
                {t('summaryDiscount')}
                {o.promoCode ? ` · ${o.promoCode}` : null}
              </dt>
              <dd>
                −<Price soum={o.discountSoum} locale={locale} />
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-6">
            <dt className="text-muted">{t('summaryShipping')}</dt>
            <dd>
              {o.shippingSoum === 0 ? (
                tc('freeShipping')
              ) : (
                <Price soum={o.shippingSoum} locale={locale} />
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-6 text-lg font-bold">
            <dt>{t('summaryTotal')}</dt>
            <dd data-testid="order-total">
              <Price soum={o.totalSoum} locale={locale} />
            </dd>
          </div>
        </dl>
      </section>

      {expired ? null : <PrepVideo howTo={home?.howTo ?? null} />}
    </div>
  );

  function stepSub(s: OrderTimelineStepDto): string | null {
    if (s.key === 'DELIVERED' && s.state !== 'done')
      return s.at ? t('stepDeliveredBy', { when: when(s.at) }) : null;
    if (s.at) return when(s.at);
    if (s.key === 'PACKING' && s.state === 'current') return t('stepPacking');
    // "Courier details appear here" — unless they already do (courier card below the timeline).
    if (s.key === 'SHIPPED' && s.state !== 'done')
      return tracking?.courier ? null : t('stepShipped');
    return null;
  }
}

function TimelineStep({
  step,
  title,
  sub,
  last,
  nextDone,
  carrier,
}: {
  step: OrderTimelineStepDto;
  title: string;
  sub: string | null;
  last: boolean;
  nextDone: boolean;
  carrier: 'YANDEX' | 'BTS' | null;
}) {
  const done = step.state === 'done';
  return (
    <li className="flex gap-4" aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="flex flex-col items-center">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-pill',
            done
              ? 'bg-forest text-white'
              : step.state === 'current'
                ? 'border-2 border-forest'
                : 'border-2 border-line',
          )}
        >
          {done ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
          {step.state === 'current' ? (
            <span aria-hidden className="size-2.5 rounded-pill bg-forest" />
          ) : null}
        </span>
        {last ? null : (
          <span
            aria-hidden
            className={cn('min-h-9 w-0.5 flex-1', done && nextDone ? 'bg-forest' : 'bg-line')}
          />
        )}
      </span>
      <span className={cn('flex flex-col gap-1.5', !last && 'pb-5')}>
        <b
          className={cn(
            'text-base',
            done || step.state === 'current' ? 'font-bold' : 'font-medium',
          )}
        >
          {title}
        </b>
        {sub ? (
          <span className="inline-flex items-center gap-2.5 text-[13px] text-muted">
            {carrier ? (
              <Logo
                src={logos.light[carrier]}
                alt={logoAlt[carrier]}
                className={carrier === 'YANDEX' ? 'h-3.5' : 'h-5'}
              />
            ) : null}
            {sub}
          </span>
        ) : null}
      </span>
    </li>
  );
}
