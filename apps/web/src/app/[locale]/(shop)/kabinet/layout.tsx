import type { Locale } from '@forest/contracts';
import { formatUzPhone } from '@forest/contracts/core';
import { User } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link, redirect } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ClientMessages } from '@/components/client-messages';
import { AccountNav } from '@/components/account/account-nav';
import { getMe } from '@/lib/customer';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** `/{locale}/kabinet/*` (design: Kabinet). Guests are sent to the SMS login and back. */
export default async function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const me = await getMe(locale);
  if (!me) redirect({ href: `${routes.login}?next=${encodeURIComponent(routes.account)}`, locale });
  const t = await getTranslations('account');
  // Telegram-only accounts have no phone; show the Telegram handle instead (or a generic label
  // when the Telegram account has no username either).
  const contact = me!.phone
    ? formatUzPhone(me!.phone)
    : me!.telegram?.username
      ? `@${me!.telegram.username}`
      : null;
  const title = me!.name ?? contact ?? t('telegramAccount');

  return (
    <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-2.5 px-3 pb-16 lg:gap-4 lg:px-6 lg:pt-2">
      <div className="flex w-full flex-col gap-2.5 lg:max-w-[320px] lg:flex-[1_1_280px] lg:gap-4">
        <div className="flex items-center gap-4 rounded-lg bg-ink p-5 text-white lg:flex-col lg:items-start lg:gap-5 lg:rounded-xl lg:p-8">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-pill bg-forest text-2xl font-semibold lg:size-[72px] lg:text-[28px]"
          >
            {me!.name ? me!.name.trim().slice(0, 1).toUpperCase() : <User size={26} />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              data-testid="account-identity"
              className="truncate text-xl font-semibold tracking-[-0.02em] lg:text-2xl"
            >
              {title}
            </span>
            {me!.name && contact ? (
              <span className="tabular text-sm text-on-dark-muted" data-private>
                {contact}
              </span>
            ) : null}
          </span>
          <Link
            href={`${routes.account}/sozlamalar`}
            className="hidden rounded-pill border border-[#3A4035] px-4 py-2.5 text-[13px] lg:inline-block"
          >
            {t('editProfile')}
          </Link>
        </div>
        <ClientMessages namespaces={['account']}>
          <AccountNav
            counts={{
              orders: me!.ordersCount,
              addresses: me!.addressesCount,
              favorites: me!.favoritesCount,
            }}
          />
        </ClientMessages>
      </div>
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-2.5 lg:gap-4">{children}</div>
    </div>
  );
}
