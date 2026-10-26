import type { CategoryDto, PublicSettingsDto } from '@forest/contracts';
import { formatUzPhone } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import Image from 'next/image';
import { Logo } from '@/components/ui/logo';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageReady, routes, telegramUrl } from '@/config/site';
import { expressZone, regionsZone } from '@/lib/delivery';
import { FooterSubscribe } from '@/components/lead/footer-subscribe';
import logoWhite from '../../../public/brand/forest-logo-white.png';
import paymeDark from '../../../public/logos/payme-on-dark.png';
import clickDark from '../../../public/logos/click-on-dark.png';
import yandexDark from '../../../public/logos/yandex-delivery-on-dark.png';
import btsDark from '../../../public/logos/bts-on-dark.png';
import { InstagramIcon, TelegramIcon } from './icons';

const heading = 'text-[13px] font-semibold tracking-[0.08em] text-white uppercase';
const link = 'text-on-dark-muted transition-colors hover:text-white';
const logoPill = 'inline-flex h-11 items-center rounded-pill border border-[#3A4035] px-[18px]';
/** Payment logos: bare on mobile (design), outlined pills on desktop. */
const paymentPill =
  'inline-flex items-center md:h-11 md:rounded-pill md:border md:border-[#3A4035] md:px-[18px]';

export async function Footer({
  settings,
  categories,
  locale,
}: {
  settings: PublicSettingsDto | null;
  categories: CategoryDto[];
  locale: 'uz' | 'ru';
}) {
  const t = await getTranslations('footer');
  const store = settings?.store;
  const express = settings ? expressZone(settings) : undefined;
  const regions = settings ? regionsZone(settings) : undefined;
  const year = new Date().getFullYear();

  return (
    <footer className="px-3 pb-3 md:px-4 md:pb-4">
      <div className="mx-auto flex max-w-[1408px] flex-col gap-12 rounded-lg bg-ink px-[22px] pt-6 pb-6 text-on-dark-muted md:rounded-xl md:px-12 md:pt-14 md:pb-8">
        <div className="flex flex-wrap justify-between gap-12">
          <div className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-6">
            <Image
              src={logoWhite}
              alt="Forest"
              width={220}
              sizes="220px"
              className="w-[120px] md:w-[220px]"
            />
            <p className="hidden text-[15px] leading-relaxed md:block">{t('tagline')}</p>
            <div className="hidden md:block">
              <FooterSubscribe />
            </div>
          </div>
          <div className="hidden flex-[2_1_600px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-8 text-sm md:grid">
            <nav aria-labelledby="ftr-shop" className="flex flex-col gap-3">
              <h2 id="ftr-shop" className={heading}>
                {t('shop')}
              </h2>
              {categories.map((c) => (
                <Link key={c.slug} href={routes.category(c.slug)} className={link}>
                  {c.name}
                </Link>
              ))}
            </nav>
            <nav aria-labelledby="ftr-help" className="flex flex-col gap-3">
              <h2 id="ftr-help" className={heading}>
                {t('help')}
              </h2>
              {pageReady.inspiration ? (
                <Link href={routes.inspiration} className={link}>
                  {t('guide')}
                </Link>
              ) : null}
              {express && regions ? (
                <Link href={routes.deliveryPayment} className={link}>
                  {t('delivery', { tashkent: express.promiseHours, regions: regions.promiseHours })}
                </Link>
              ) : null}
              <Link href={routes.account} className={link}>
                {t('tracking')}
              </Link>
              <Link href={routes.returns} className={link}>
                {t('returns')}
              </Link>
            </nav>
            {pageReady.brand ? (
              <nav aria-labelledby="ftr-company" className="flex flex-col gap-3">
                <h2 id="ftr-company" className={heading}>
                  {t('company')}
                </h2>
                <Link href={routes.brand} className={link}>
                  {t('brand')}
                </Link>
                <Link href={routes.brand} className={link}>
                  {t('craftsmen')}
                </Link>
                <Link href={routes.brand} className={link}>
                  {t('seller')}
                </Link>
              </nav>
            ) : null}
            {store ? (
              <div className="flex flex-col gap-3">
                <h2 className={heading}>{t('contact')}</h2>
                <a href={`tel:${store.phone}`} className="tabular text-lg font-semibold text-white">
                  {formatUzPhone(store.phone)}
                </a>
                <a href={`mailto:${store.email}`} className={link}>
                  {store.domain}
                </a>
                <span>{store.hours[locale]}</span>
                <span className="mt-1 flex gap-2">
                  <a
                    href={telegramUrl(store.telegramBot)}
                    aria-label="Telegram"
                    data-track="telegram_click"
                    className="grid size-10 place-items-center rounded-pill border border-[#3A4035] text-white hover:bg-dark-3"
                  >
                    <TelegramIcon size={16} />
                  </a>
                  {store.instagram ? (
                    <a
                      href={store.instagram}
                      aria-label="Instagram"
                      className="grid size-10 place-items-center rounded-pill border border-[#3A4035] text-white hover:bg-dark-3"
                    >
                      <InstagramIcon />
                    </a>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
          {store ? (
            <a
              href={`tel:${store.phone}`}
              className="tabular -mt-8 text-lg font-bold text-white md:hidden"
            >
              {formatUzPhone(store.phone)}
            </a>
          ) : null}
        </div>

        <div className="-mt-6 flex flex-wrap items-center justify-between gap-4 text-[13px] md:mt-0 md:border-t md:border-dark-3 md:pt-6">
          <span className="hidden md:inline">{t('copyright', { year })}</span>
          <ul aria-label={t('methods')} className="flex flex-wrap items-center gap-2">
            <li className={paymentPill}>
              <Logo src={paymeDark} alt="Payme" className="h-4 md:h-5" />
            </li>
            <li className={paymentPill}>
              <Logo src={clickDark} alt="Click" className="h-3.5 md:h-[18px]" />
            </li>
            {settings?.flags.cod ? (
              <li className={cn(logoPill, 'hidden px-4 font-semibold text-white md:inline-flex')}>
                {t('cod')}
              </li>
            ) : null}
            <li aria-hidden className="mx-1 hidden h-7 w-px bg-[#3A4035] md:block" />
            <li className={cn(logoPill, 'hidden md:inline-flex')}>
              <Logo src={yandexDark} alt="Yandex Dostavka" className="h-4" />
            </li>
            <li className={cn(logoPill, 'hidden md:inline-flex')}>
              <Logo src={btsDark} alt="BTS" className="h-7" />
            </li>
          </ul>
          <nav aria-label={t('offer')} className="flex flex-wrap gap-1">
            <span className="md:hidden">© {year} Forest ·</span>
            <Link href={routes.offer} className={link}>
              <span className="md:hidden">{t('mobileLegal')}</span>
              <span className="hidden md:inline">{t('offer')}</span>
            </Link>
            <span aria-hidden>·</span>
            <Link href={routes.privacy} className={link}>
              <span className="md:hidden">{t('mobilePrivacy')}</span>
              <span className="hidden md:inline">{t('privacy')}</span>
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
