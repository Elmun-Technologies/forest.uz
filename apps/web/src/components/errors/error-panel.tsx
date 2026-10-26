'use client';

import { Button } from '@forest/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';

/** Error boundary body: one main way out (retry) and one alternative (home). */
export function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-[1440px] px-3 py-6 lg:px-6 lg:py-10">
      <section
        role="alert"
        data-testid="error-boundary"
        className="mx-auto flex max-w-[560px] flex-col items-start gap-[18px] rounded-[36px] bg-panel p-8"
      >
        <span
          aria-hidden
          className="grid size-16 place-items-center rounded-pill bg-critical-bg text-critical"
        >
          <TriangleAlert size={28} />
        </span>
        <h1 className="text-[30px] font-medium tracking-[-0.03em]">{t('errorTitle')}</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">{t('errorText')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>{t('retry')}</Button>
          <Button asChild variant="outline">
            <Link href={routes.home}>{t('toHome')}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
