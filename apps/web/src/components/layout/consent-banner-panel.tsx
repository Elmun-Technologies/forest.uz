'use client';

import { Button, Switch } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { writeConsent } from '@/lib/consent';

/**
 * Cookie consent (analytics vs marketing, docs/07). UI only: stores the choice in `fr_consent`
 * and emits `fr:consent`; the Phase 4 tracker reads it. Shown until the visitor decides.
 */
export default function ConsentBanner() {
  const t = useTranslations('consent');
  const [open, setOpen] = useState(true);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const titleId = useId();
  const aId = useId();
  const mId = useId();

  if (!open) return null;
  const decide = (choice: { analytics: boolean; marketing: boolean }) => {
    writeConsent(choice);
    setOpen(false);
  };

  return (
    <section
      aria-labelledby={titleId}
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-4 rounded-md bg-panel p-5 text-sm shadow-float sm:right-auto sm:left-6 sm:bottom-6 sm:max-w-[440px]"
    >
      <h2 id={titleId} className="text-base font-semibold">
        {t('title')}
      </h2>
      <p className="leading-relaxed text-ink-2">
        {t('text')}{' '}
        <Link href={routes.privacy} prefetch={false} className="font-medium underline">
          {t('privacy')}
        </Link>
      </p>
      {custom ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex items-start justify-between gap-4">
            <span className="flex flex-col gap-0.5">
              <label htmlFor={aId} className="font-semibold">
                {t('analytics')}
              </label>
              <span className="text-xs text-muted">{t('analyticsHint')}</span>
            </span>
            <Switch id={aId} checked={analytics} onCheckedChange={setAnalytics} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="flex flex-col gap-0.5">
              <label htmlFor={mId} className="font-semibold">
                {t('marketing')}
              </label>
              <span className="text-xs text-muted">{t('marketingHint')}</span>
            </span>
            <Switch id={mId} checked={marketing} onCheckedChange={setMarketing} />
          </div>
          <Button size="sm" onClick={() => decide({ analytics, marketing })}>
            {t('save')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => decide({ analytics: true, marketing: true })}>
            {t('acceptAll')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide({ analytics: false, marketing: false })}
          >
            {t('necessary')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>
            {t('customize')}
          </Button>
        </div>
      )}
    </section>
  );
}
