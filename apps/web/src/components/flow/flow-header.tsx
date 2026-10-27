import { Lock } from 'lucide-react';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import logo from '../../../public/brand/forest-logo-green.png';

/** Desktop header of the focused flow (checkout): logo, "Xavfsiz to'lov", help phone. */
export async function FlowHeader({ phone }: { phone: string | null }) {
  const t = await getTranslations('common');
  const th = await getTranslations('header');
  return (
    <header className="mx-auto hidden max-w-[1440px] flex-wrap items-center gap-4 px-6 py-5 lg:flex">
      <Link href={routes.home} aria-label={th('homeLabel')} className="block w-[120px]">
        <Image src={logo} alt="Forest" width={120} sizes="120px" priority />
      </Link>
      <span className="ml-4 inline-flex items-center gap-2 rounded-pill bg-panel px-4 py-2.5 text-[13px] font-medium">
        <Lock size={16} className="text-forest" aria-hidden />
        {t('secure')}
      </span>
      {phone ? (
        <span className="ml-auto text-sm">
          {t('question')}{' '}
          <a href={`tel:${phone.replace(/\s/g, '')}`} className="tabular font-bold">
            {phone}
          </a>
        </span>
      ) : null}
    </header>
  );
}
