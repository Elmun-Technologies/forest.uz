'use client';

import { Price } from '@forest/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { quietRoutes, routes, telegramUrl } from '@/config/site';
import { useCart } from '@/components/cart/cart-provider';
import { TelegramIcon } from './icons';

/** Product pages render their own sticky buy bar on mobile. */
const ownBottomBar = ['/p/'];

/**
 * Desktop: floating "Savol bormi?" Telegram button.
 * Mobile: bottom bar = round Telegram button + "Savat · n | sum" (when the cart has items).
 * Hidden on cart/checkout/account flows (`quietRoutes`).
 */
export function FloatingActions({ telegramBot }: { telegramBot: string | null }) {
  const t = useTranslations('fab');
  const tc = useTranslations('cart');
  const locale = useLocale() as 'uz' | 'ru';
  const pathname = usePathname();
  const { count, totalSoum } = useCart();
  if (quietRoutes.some((r) => pathname.startsWith(r))) return null;
  const mobileBarHidden = ownBottomBar.some((r) => pathname.startsWith(r));
  const tg = telegramBot ? telegramUrl(telegramBot, 'site') : null;

  return (
    <>
      {tg ? (
        <a
          href={tg}
          aria-label={t('label')}
          data-track="telegram_click"
          className="fr-fab fixed right-6 bottom-6 z-30 hidden items-center gap-2.5 rounded-pill bg-forest py-3.5 pr-5 pl-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgb(20_23_18/0.25)] transition-colors hover:bg-forest-700 lg:inline-flex"
        >
          <span className="grid size-8 place-items-center rounded-pill bg-white text-forest">
            <TelegramIcon size={16} />
          </span>
          {t('text')}
        </a>
      ) : null}
      {mobileBarHidden ? null : (
        <nav
          aria-label={tc('quickActions')}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas from-70% to-canvas/0 px-3 pt-2.5 pb-3.5 lg:hidden"
        >
          <div className="flex justify-end gap-2">
            {tg ? (
              <a
                href={tg}
                aria-label={t('label')}
                data-track="telegram_click"
                className="pointer-events-auto grid size-14 shrink-0 place-items-center rounded-pill bg-forest text-white"
              >
                <TelegramIcon size={22} />
              </a>
            ) : null}
            {count > 0 ? (
              <Link
                href={routes.cart}
                prefetch={false}
                data-testid="mobile-cart-bar"
                className="pointer-events-auto flex h-14 flex-1 items-center justify-between rounded-pill bg-ink pr-2 pl-[22px] text-[15px] font-semibold text-white"
              >
                {tc('bar', { count })}
                <span className="rounded-pill bg-white px-3.5 py-2.5 text-sm text-ink">
                  <Price soum={totalSoum} locale={locale} />
                </span>
              </Link>
            ) : null}
          </div>
        </nav>
      )}
    </>
  );
}
