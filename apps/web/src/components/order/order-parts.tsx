import type { HomeHowToDto, OrderPublicDto } from '@forest/contracts';
import { Price } from '@forest/ui';
import { Play } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';

type Locale = 'uz' | 'ru';

/** Path of the absolute tracking URL the API returns (`APP_URL/t/<token>`), host-independent. */
export function trackingPath(order: Pick<OrderPublicDto, 'trackingUrl'>): string {
  try {
    return new URL(order.trackingUrl).pathname;
  } catch {
    return order.trackingUrl;
  }
}

/** Online payment that can still be completed or retried (reservation alive). */
export function needsPayment(o: OrderPublicDto): boolean {
  return o.paymentMethod !== 'COD' && o.canRetryPayment && o.reservationExpiresAt !== null;
}

export async function OrderItems({ order, locale }: { order: OrderPublicDto; locale: Locale }) {
  const t = await getTranslations('order');
  return (
    <ul className="flex flex-col">
      {order.items.map((i, n) => (
        <li
          key={`${i.name}-${i.variantLabel}-${n}`}
          className="flex flex-wrap items-center gap-4 border-t border-line py-4 lg:gap-5"
        >
          <span className="relative size-14 shrink-0 overflow-hidden rounded-[14px] bg-canvas lg:size-[72px] lg:rounded-[18px]">
            {i.image ? (
              <Image src={i.image.url} alt="" fill sizes="72px" className="object-cover" />
            ) : null}
          </span>
          <span className="min-w-0 flex-[1_1_200px] text-[15px] lg:text-base">
            <b className="font-semibold">{i.name}</b>
            <span className="block text-sm text-muted">
              {i.variantLabel
                ? t('qtyLine', { variant: i.variantLabel, qty: i.qty })
                : t('qtyOnly', { qty: i.qty })}
            </span>
          </span>
          <Price soum={i.lineTotalSoum} locale={locale} className="font-bold" />
        </li>
      ))}
    </ul>
  );
}

/** "Kuryer kelguncha tayyorlaning" — only when an admin-managed how-to video exists. */
export async function PrepVideo({ howTo }: { howTo: HomeHowToDto | null }) {
  if (!howTo?.videoUrl) return null;
  const t = await getTranslations('order');
  const caption = howTo.durationMinutes
    ? t('video', { minutes: howTo.durationMinutes })
    : t('videoNoDuration');
  return (
    <section className="flex flex-wrap gap-2.5 lg:mt-4 lg:gap-4">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col justify-between gap-8 rounded-lg bg-ink p-7 text-white lg:rounded-xl lg:p-12">
        <h2 className="text-[30px] leading-[1.02] font-medium tracking-[-0.04em] lg:text-h2">
          {t('prepTitle')}
        </h2>
        <p className="leading-relaxed text-on-dark-muted">{t('prepText')}</p>
        <a
          href={howTo.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start rounded-pill bg-white px-6 py-3.5 text-[15px] font-semibold text-ink"
        >
          {t('prepCta')}
        </a>
      </div>
      {howTo.poster ? (
        <a
          href={howTo.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative min-h-[260px] min-w-0 flex-[1_1_380px] overflow-hidden rounded-lg text-white lg:min-h-[400px] lg:rounded-xl"
        >
          <Image
            src={howTo.poster.url}
            alt={howTo.poster.alt}
            fill
            sizes="(min-width: 1024px) 680px, 100vw"
            className="object-cover"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-ink/70 to-ink/0 to-60%" />
          <span className="absolute top-1/2 left-1/2 grid size-[88px] -translate-1/2 place-items-center rounded-pill bg-white text-ink">
            <Play size={28} fill="currentColor" aria-hidden />
          </span>
          <span className="absolute right-8 bottom-8 left-8 text-2xl font-semibold">{caption}</span>
        </a>
      ) : null}
    </section>
  );
}
