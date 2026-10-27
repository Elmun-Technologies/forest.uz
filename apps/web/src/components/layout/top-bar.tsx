import type { PublicSettingsDto } from '@forest/contracts';
import { Clock, Truck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { expressZone, regionsZone } from '@/lib/delivery';

/** Delivery promise bar above the header; all values come from delivery-zone settings. */
export async function TopBar({
  settings,
  locale,
}: {
  settings: PublicSettingsDto;
  locale: 'uz' | 'ru';
}) {
  const t = await getTranslations('header');
  const tc = await getTranslations('common');
  const express = expressZone(settings);
  const regions = regionsZone(settings);
  if (!express && !regions) return null;
  const b = (chunks: React.ReactNode) => <b className="font-bold text-white">{chunks}</b>;
  return (
    <div className="bg-forest text-[#E6EBDF]">
      <p className="hidden flex-wrap justify-center gap-x-7 gap-y-1.5 px-4 py-[9px] text-[13px] font-medium md:flex">
        {express ? (
          <span className="inline-flex items-center gap-2">
            <Clock size={14} strokeWidth={2} aria-hidden />
            {t.rich('topTashkent', { eta: express.etaLabel[locale], b })}
          </span>
        ) : null}
        {regions ? (
          <span className="inline-flex items-center gap-2">
            <Truck size={14} strokeWidth={2} aria-hidden />
            {t.rich('topRepublic', { eta: regions.etaLabel[locale], b })}
          </span>
        ) : null}
      </p>
      {express && regions ? (
        <p className="px-3 py-2 text-center text-xs font-medium md:hidden">
          {t.rich('topMobile', {
            tashkent: tc('hours', { count: express.promiseHours }),
            regions: tc('hours', { count: regions.promiseHours }),
            b,
          })}
        </p>
      ) : null}
    </div>
  );
}
