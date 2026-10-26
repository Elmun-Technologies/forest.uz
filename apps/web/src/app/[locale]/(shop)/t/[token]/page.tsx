import type { Locale, TrackingDto } from '@forest/contracts';
import { formatTashkentDate, formatTashkentHm, tashkentDayDiff } from '@forest/contracts/core';
import { cn, Price } from '@forest/ui';
import { Check, Send } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { ChangeAddress } from '@/components/order/change-address';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { ApiError, apiGet } from '@/lib/api';
import { getHomeContent } from '@/lib/data';
import { formatWhen, placeName } from '@/lib/format';

type Props = { params: Promise<{ locale: Locale; token: string }> };

async function loadTracking(token: string, locale: Locale): Promise<TrackingDto> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(token)) notFound();
  try {
    return await apiGet<TrackingDto>(`/track/${encodeURIComponent(token)}`, locale, {
      personal: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'track' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * `/t/[token]` (rewritten to `/{locale}/t/[token]` by the middleware) — tracking without login
 * (design: Kuzatish). The link is shareable, so the API masks contact data for non-owners.
 */
export default async function TrackingPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [o, home, t, tc] = await Promise.all([
    loadTracking(token, locale),
    getHomeContent(locale),
    getTranslations('track'),
    getTranslations('common'),
  ]);
  const now = new Date();
  const carrier = o.carrier === 'PICKUP' ? null : o.carrier;
  const delivered = o.status === 'DELIVERED' || o.status === 'COMPLETED';
  const day = (iso: string) => {
    const d = new Date(iso);
    const diff = tashkentDayDiff(now, d);
    return diff === 0 ? t('today') : diff === 1 ? t('tomorrow') : formatTashkentDate(d);
  };
  const deliveredAt = o.timeline.find((s) => s.key === 'DELIVERED' && s.state === 'done')?.at;

  const eta: { label: string; value: string } =
    delivered && deliveredAt
      ? { label: t('etaDelivered'), value: formatWhen(tc, deliveredAt, now) }
      : o.courier?.etaFrom && o.courier.etaTo
        ? {
            label: t('etaCourier'),
            value: t('range', {
              day: day(o.courier.etaFrom),
              from: formatTashkentHm(new Date(o.courier.etaFrom)),
              to: formatTashkentHm(new Date(o.courier.etaTo)),
            }),
          }
        : o.slaDueAt
          ? {
              label: t('etaPromise'),
              value: t('by', {
                day: day(o.slaDueAt),
                time: formatTashkentHm(new Date(o.slaDueAt)),
              }),
            }
          : { label: t('etaPending'), value: t('etaPendingValue') };

  const current = o.timeline.findIndex((s) => s.state === 'current');
  const video = home?.howTo?.videoUrl ? home.howTo : null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 pb-16 lg:gap-4 lg:px-6 lg:pt-2">
      <section className="flex flex-col gap-6 rounded-lg bg-panel p-5 lg:gap-7 lg:rounded-xl lg:px-11 lg:py-9">
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] text-muted">{t('linkNote')}</span>
          <h1 className="text-[30px] leading-[0.95] font-medium tracking-[-0.05em] sm:text-[36px] lg:text-[64px]">
            {/* The order number must not wrap at its dash on narrow screens. */}
            {t.rich('title', {
              number: o.number,
              num: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
            })}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-6 rounded-lg bg-ink px-6 py-6 text-white lg:rounded-[28px] lg:px-8 lg:py-7">
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-on-dark-subtle">{eta.label}</span>
            <b
              data-testid="tracking-eta"
              className="text-[30px] leading-none font-medium tracking-[-0.03em] lg:text-[44px]"
            >
              {eta.value}
            </b>
          </div>
          {carrier ? (
            <span className="flex items-center gap-3 rounded-[18px] bg-dark-2 px-4 py-3">
              <Logo
                src={logos.dark[carrier]}
                alt={logoAlt[carrier]}
                className={carrier === 'YANDEX' ? 'h-[18px]' : 'h-7'}
              />
              {o.carrierRef ? (
                <span className="text-[13px] text-on-dark-muted">
                  {t('carrierRef', { ref: o.carrierRef })}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <ol
          aria-label={t('metaTitle')}
          data-testid="tracking-steps"
          className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-2"
        >
          {o.timeline.map((s, i) => {
            const done = s.state === 'done';
            const isCurrent = i === current;
            const time = s.at
              ? done
                ? formatTashkentHm(new Date(s.at))
                : `~${formatTashkentHm(new Date(s.at))}`
              : null;
            return (
              <li
                key={s.key}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex flex-col gap-2.5"
              >
                <span
                  aria-hidden
                  className={cn(
                    'hidden h-1.5 rounded-pill sm:block',
                    done || isCurrent ? 'bg-forest' : 'bg-[#E4E6DF]',
                  )}
                />
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-[22px] shrink-0 place-items-center rounded-pill text-xs font-bold',
                      done
                        ? 'bg-forest text-white'
                        : isCurrent
                          ? 'bg-[#FFD43B] text-ink'
                          : 'bg-canvas text-subtle',
                    )}
                  >
                    {done ? <Check size={12} strokeWidth={3} /> : isCurrent ? '•' : null}
                  </span>
                  <b
                    className={cn(
                      'text-sm font-semibold',
                      done || isCurrent ? 'text-ink' : 'text-subtle',
                    )}
                  >
                    {s.label}
                  </b>
                </span>
                {time ? <span className="pl-[30px] text-xs text-muted">{time}</span> : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex flex-wrap items-stretch gap-2.5 lg:gap-4">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-3 rounded-lg bg-panel p-4 lg:rounded-[32px]">
          {o.courier ? (
            <div className="flex flex-wrap items-center gap-3.5 px-3 pt-2 pb-1.5">
              <span
                aria-hidden
                className="grid size-12 place-items-center rounded-pill bg-sage font-bold"
              >
                {o.courier.name.slice(0, 1)}
              </span>
              <span className="flex flex-[1_1_200px] flex-col gap-0.5">
                <b className="text-[15px] font-semibold">
                  {t('courier', { name: o.courier.name })}
                </b>
                {o.courier.car ? (
                  <span className="text-[13px] text-muted">
                    {o.courier.plate
                      ? t('courierCar', { car: o.courier.car, plate: o.courier.plate })
                      : o.courier.car}
                  </span>
                ) : null}
              </span>
              {o.courier.distanceKm !== null ? (
                <span className="rounded-pill bg-canvas px-3.5 py-2 text-[13px] font-semibold">
                  {t('distance', {
                    km: o.courier.distanceKm.toLocaleString(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
          {o.history.length ? (
            <div className="flex flex-col gap-1 px-5 py-4">
              <h2 className="mb-2 text-[22px] font-semibold">{t('historyTitle')}</h2>
              <ol>
                {[...o.history].reverse().map((h, i) => (
                  <li
                    key={`${h.at}-${i}`}
                    className="grid grid-cols-[110px_14px_minmax(0,1fr)] items-start gap-3.5 py-2.5"
                  >
                    <span className="tabular text-[13px] text-muted">
                      {formatTashkentDate(new Date(h.at)).slice(0, 5)}{' '}
                      {formatTashkentHm(new Date(h.at))}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1 size-3.5 rounded-pill',
                        i === 0 ? 'bg-forest shadow-[0_0_0_4px_var(--color-sage)]' : 'bg-[#C9CDC2]',
                      )}
                    />
                    <span className="flex flex-col gap-0.5">
                      <b className="text-[15px] font-semibold">{h.place}</b>
                      <span className="text-[13px] text-muted">{h.note}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {!o.courier && !o.history.length ? (
            <p className="flex flex-1 items-center rounded-[24px] bg-canvas p-6 text-[15px] leading-relaxed text-muted">
              {t('noCourier')}
            </p>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-[2_1_360px] flex-col gap-2.5 lg:gap-4">
          <div className="flex flex-col gap-3 rounded-lg bg-panel p-6 text-sm lg:rounded-[32px]">
            <h2 className="text-xl font-semibold">{t('contents')}</h2>
            <ul className="flex flex-col gap-3">
              {o.items.map((i, n) => (
                <li key={`${i.name}-${n}`} className="flex items-center gap-3">
                  <span className="relative size-[52px] shrink-0 overflow-hidden rounded-[14px] bg-canvas">
                    {i.image ? (
                      <Image src={i.image.url} alt="" fill sizes="52px" className="object-cover" />
                    ) : null}
                  </span>
                  <span className="flex-1">
                    {i.name}
                    {i.variantLabel ? ` · ${i.variantLabel}` : null}
                    {i.qty > 1 ? ` × ${i.qty}` : null}
                  </span>
                  <Price
                    soum={i.lineTotalSoum}
                    locale={locale}
                    withCurrency={false}
                    className="font-bold"
                  />
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-3 border-t border-line-soft pt-3">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t('payment')}</dt>
                <dd className="inline-flex items-center gap-2">
                  {o.paymentMethod === 'COD' ? (
                    tc('payment.COD')
                  ) : (
                    <Logo
                      src={logos.light[o.paymentMethod]}
                      alt={logoAlt[o.paymentMethod]}
                      className="h-3.5"
                    />
                  )}
                  <b className={o.paymentStatus === 'PAID' ? 'text-good' : undefined}>
                    <PaymentStatus status={o.paymentStatus} />
                  </b>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t('address')}</dt>
                <dd className="text-right font-semibold">
                  {[placeName(o.address, locale), o.address.line].filter(Boolean).join(', ')}
                </dd>
              </div>
              <div className="flex justify-between gap-4 text-base">
                <dt>{t('total')}</dt>
                <dd className="font-bold">
                  <Price soum={o.totalSoum} locale={locale} />
                </dd>
              </div>
            </dl>
          </div>
          {video ? (
            <div className="flex flex-col gap-3 rounded-lg bg-sage p-6 lg:rounded-[32px]">
              <b className="text-lg font-semibold">{t('prepTitle')}</b>
              <span className="text-sm leading-[1.55] text-[#2A2E26]">{t('prepText')}</span>
              <a
                href={video.videoUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start rounded-pill bg-ink px-[18px] py-3 text-sm font-semibold text-white"
              >
                {t('prepCta')}
              </a>
            </div>
          ) : null}
          {o.telegramDeepLink || o.canChangeAddress ? (
            <div className="flex flex-wrap gap-2.5 rounded-lg bg-panel px-6 py-5 lg:rounded-[32px]">
              {o.telegramDeepLink ? (
                <a
                  href={o.telegramDeepLink}
                  data-track="telegram_click"
                  className="inline-flex h-12 flex-[1_1_140px] items-center justify-center gap-2 rounded-pill border border-line text-sm font-semibold hover:border-ink"
                >
                  <Send size={16} className="text-telegram" aria-hidden />
                  {t('bot')}
                </a>
              ) : null}
              {o.canChangeAddress ? (
                <ClientMessages namespaces={['track']}>
                  <ChangeAddress
                    token={token}
                    region={o.address.region}
                    district={o.address.district}
                    line={o.address.line}
                  />
                </ClientMessages>
              ) : null}
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}

async function PaymentStatus({ status }: { status: TrackingDto['paymentStatus'] }) {
  const t = await getTranslations('order');
  return <>{t(`paymentStatus.${status}`)}</>;
}
