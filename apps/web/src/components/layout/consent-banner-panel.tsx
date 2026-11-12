'use client';

import { Button, Switch } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { writeConsent } from '@/lib/consent';

/**
 * Phones: two equal 44 px buttons in one row (desktop keeps the 36 px `sm` buttons); `relative`
 * paints them above the enlarged hit area of a text link on the paragraph's last line.
 */
const phoneButton = 'max-lg:relative max-lg:h-11 max-lg:min-w-0 max-lg:flex-1 max-lg:px-3';

/**
 * Cookie consent (analytics, session recording, marketing — docs/07). UI only: stores the choice
 * in `fr_consent` and emits `fr:consent`; the tracker and the replay gate read it. Shown until the
 * visitor decides. Recording is opt-in: "Sozlash" starts with it off.
 */
export default function ConsentBanner() {
  const t = useTranslations('consent');
  const [open, setOpen] = useState(true);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [replay, setReplay] = useState(false);
  const titleId = useId();
  const aId = useId();
  const mId = useId();
  const rId = useId();

  if (!open) return null;
  const decide = (choice: { analytics: boolean; marketing: boolean; replay: boolean }) => {
    writeConsent(choice);
    setOpen(false);
  };

  return (
    <section
      aria-labelledby={titleId}
      data-testid="consent-banner"
      className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 rounded-md bg-panel p-3 text-sm shadow-float sm:right-auto sm:left-6 sm:bottom-6 sm:max-w-[440px] lg:gap-4 lg:p-5"
    >
      {/* Phones: the heading is read out but not drawn (the text says it), saving a line. */}
      <h2 id={titleId} className="text-base font-semibold max-lg:sr-only">
        {t('title')}
      </h2>
      <p className="text-xs leading-snug text-ink-2 lg:text-sm lg:leading-relaxed">
        {t('text')}{' '}
        <Link href={routes.privacy} prefetch={false} className="hit-44 font-medium underline">
          {t('privacy')}
        </Link>
        {custom ? null : (
          // Phones: "Sozlash" moves into the text so the choices fit one button row.
          <span className="lg:hidden">
            {' · '}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="hit-44 font-medium underline"
            >
              {t('customize')}
            </button>
          </span>
        )}
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
              <label htmlFor={rId} className="font-semibold">
                {t('replay')}
              </label>
              <span className="text-xs text-muted">{t('replayHint')}</span>
            </span>
            {/* Recording needs analytics: off and locked while analytics is off. */}
            <Switch
              id={rId}
              checked={analytics && replay}
              disabled={!analytics}
              onCheckedChange={setReplay}
              data-testid="consent-replay"
            />
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
          <Button
            size="sm"
            className="max-lg:h-11"
            onClick={() => decide({ analytics, marketing, replay: analytics && replay })}
          >
            {t('save')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 lg:flex-wrap">
          <Button
            size="sm"
            className={phoneButton}
            onClick={() => decide({ analytics: true, marketing: true, replay: true })}
          >
            {t('acceptAll')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={phoneButton}
            onClick={() => decide({ analytics: false, marketing: false, replay: false })}
          >
            {t('necessary')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="max-lg:hidden"
            onClick={() => setCustom(true)}
          >
            {t('customize')}
          </Button>
        </div>
      )}
    </section>
  );
}
