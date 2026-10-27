import type { TrackingDto } from '@forest/contracts';
import { formatTashkentDate, formatTashkentHm } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import { MapPin, Phone } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { isMasked, telHref } from '@/lib/carrier';

type Courier = NonNullable<TrackingDto['courier']>;
type Locale = 'uz' | 'ru';

/**
 * Courier card (design: Kuzatish "Jasur · Yandex kuryer", Chevrolet Damas · plate, Qo'ng'iroq).
 * The call button exists only for the owner's unmasked number; others see the masked number and
 * a login hint (`loginNext` = this page).
 */
export async function CourierCard({
  courier,
  carrier,
  locale,
  loginNext,
  compact = false,
}: {
  courier: Courier;
  carrier: TrackingDto['carrier'];
  locale: Locale;
  loginNext: string;
  compact?: boolean;
}) {
  const t = await getTranslations('track');
  const phone = courier.phone;
  const masked = phone ? isMasked(phone) : false;
  return (
    <div
      data-testid="courier-card"
      className={cn('flex flex-wrap items-center gap-3.5', compact ? 'pt-2' : 'px-3 pt-2 pb-1.5')}
    >
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center rounded-pill bg-sage font-bold"
      >
        {courier.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <b className="text-[15px] font-semibold" data-testid="courier-name">
          {carrier === 'YANDEX'
            ? t('courierYandex', { name: courier.name })
            : t('courier', { name: courier.name })}
        </b>
        {courier.car ? (
          <span className="text-[13px] text-muted" data-testid="courier-car">
            {courier.plate
              ? t('courierCar', { car: courier.car, plate: courier.plate })
              : courier.car}
          </span>
        ) : courier.plate ? (
          <span className="text-[13px] text-muted">{courier.plate}</span>
        ) : null}
      </span>
      {courier.distanceKm !== null ? (
        <span className="rounded-pill bg-canvas px-3.5 py-2 text-[13px] font-semibold">
          {t('distance', {
            km: courier.distanceKm.toLocaleString(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
              maximumFractionDigits: 1,
            }),
          })}
        </span>
      ) : null}
      {phone && !masked ? (
        // The courier's number is in the tel: link: blocked from session recordings entirely.
        <span className="flex flex-col items-start gap-1 sm:items-end" data-private="block">
          <a
            href={telHref(phone, courier.phoneExt)}
            data-testid="courier-call"
            data-track="courier_call"
            aria-label={t('callLabel', { name: courier.name })}
            className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-ink px-[18px] text-[15px] font-semibold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            <Phone size={16} aria-hidden />
            {t('call')}
          </a>
          {courier.phoneExt ? (
            <span className="tabular text-xs text-muted" data-testid="courier-ext">
              {t('callExt', { ext: courier.phoneExt })}
            </span>
          ) : null}
        </span>
      ) : null}
      {phone && masked ? (
        <span className="flex basis-full flex-col gap-0.5 text-[13px] text-muted sm:basis-auto">
          <span className="tabular" data-testid="courier-phone-masked">
            {phone}
          </span>
          <span>
            {t.rich('callLogin', {
              login: (c) => (
                <Link
                  href={`${routes.login}?next=${encodeURIComponent(loginNext)}`}
                  prefetch={false}
                  className="font-semibold text-ink underline"
                >
                  {c}
                </Link>
              ),
            })}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** Carrier history (newest first) with the API's localized labels; BTS gets its own title. */
export async function CarrierHistory({
  history,
  carrier,
}: {
  history: TrackingDto['history'];
  carrier: TrackingDto['carrier'];
}) {
  if (!history.length) return null;
  const t = await getTranslations('track');
  return (
    <div className="flex flex-col gap-1 px-5 py-4" data-testid="carrier-history">
      <h2 className="mb-2 text-[22px] font-semibold">
        {carrier === 'BTS' ? t('historyTitleBts') : t('historyTitle')}
      </h2>
      <ol>
        {[...history].reverse().map((h, i) => {
          const title = h.place || h.note;
          const sub = h.place ? h.note : '';
          return (
            <li
              key={`${h.at}-${i}`}
              className="grid grid-cols-[96px_14px_minmax(0,1fr)] items-start gap-3.5 py-2.5 sm:grid-cols-[110px_14px_minmax(0,1fr)]"
            >
              <span className="tabular text-[13px] text-muted">
                <time dateTime={h.at}>
                  {formatTashkentDate(new Date(h.at)).slice(0, 5)}{' '}
                  {formatTashkentHm(new Date(h.at))}
                </time>
              </span>
              <span
                aria-hidden
                className={cn(
                  'mt-1 size-3.5 rounded-pill',
                  i === 0 ? 'bg-forest shadow-[0_0_0_4px_var(--color-sage)]' : 'bg-[#C9CDC2]',
                )}
              />
              <span className="flex flex-col gap-0.5">
                <b className="text-[15px] font-semibold">{title}</b>
                {sub ? <span className="text-[13px] text-muted">{sub}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** "BTS Samarqand · 3-filial" block while the parcel waits at a branch. */
export async function BranchCard({ branch }: { branch: string }) {
  const t = await getTranslations('track');
  return (
    <div
      data-testid="bts-branch"
      className="flex flex-wrap items-center gap-3.5 rounded-[24px] bg-canvas p-5"
    >
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center rounded-pill bg-sage text-forest"
      >
        <MapPin size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] text-muted">{t('branchTitle')}</span>
        <b className="text-[15px] font-semibold">{branch}</b>
      </span>
    </div>
  );
}
