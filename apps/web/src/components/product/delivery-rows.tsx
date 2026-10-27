import type { PublicSettingsDto } from '@forest/contracts';
import { formatAmount, soumToTiyin } from '@forest/contracts/core';
import { Price } from '@forest/ui';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/ui/logo';
import { expressZone, regionsZone } from '@/lib/delivery';
import yandex from '../../../public/logos/yandex-delivery.png';
import bts from '../../../public/logos/bts.png';
import payme from '../../../public/logos/payme.png';
import click from '../../../public/logos/click.png';

/** Delivery & payment rows with prices from delivery-zone settings. */
export async function DeliveryRows({
  settings,
  locale,
  compact = false,
}: {
  settings: PublicSettingsDto;
  locale: 'uz' | 'ru';
  compact?: boolean;
}) {
  const t = await getTranslations('product');
  const zones = [
    {
      zone: expressZone(settings),
      logo: yandex,
      alt: 'Yandex Dostavka',
      cls: 'h-[11px]',
      title: t('deliveryTashkent'),
      via: 'deliveryTashkentVia' as const,
    },
    {
      zone: regionsZone(settings),
      logo: bts,
      alt: 'BTS',
      cls: 'h-[30px]',
      title: t('deliveryRepublic'),
      via: 'deliveryRepublicVia' as const,
    },
  ];
  return (
    <ul className={compact ? 'flex flex-col' : 'flex flex-col rounded-[24px] bg-canvas px-5 py-2'}>
      {zones.map(({ zone, logo, alt, cls, title, via }) =>
        zone ? (
          <li key={zone.key} className="flex items-center gap-3.5 border-b border-line py-3.5">
            <span
              className={
                compact
                  ? 'grid h-10 w-[104px] shrink-0 place-items-center rounded-xs bg-canvas'
                  : 'grid h-10 w-[104px] shrink-0 place-items-center rounded-xs bg-white'
              }
            >
              <Logo src={logo} alt={alt} className={cls} />
            </span>
            <span className="flex-1 text-sm leading-[1.4]">
              <b className="font-semibold">{title}</b>
              <span className="block text-muted">{t(via, { eta: zone.etaLabel[locale] })}</span>
              {zone.freeFromSoum ? (
                <span className="block text-xs text-muted">
                  {t('freeFrom', { amount: formatAmount(soumToTiyin(zone.freeFromSoum)) })}
                </span>
              ) : null}
            </span>
            <Price soum={zone.priceSoum} locale={locale} className="text-sm font-semibold" />
          </li>
        ) : null,
      )}
      <li className="flex flex-wrap items-center gap-3.5 py-3.5">
        <span className="mr-1 text-sm font-semibold">{t('payment')}</span>
        <Logo src={payme} alt="Payme" className="h-5" />
        <Logo src={click} alt="Click" className="h-[18px]" />
        {settings.flags.cod ? (
          <span className="text-[13px] text-muted">{t('paymentCod')}</span>
        ) : null}
      </li>
    </ul>
  );
}
