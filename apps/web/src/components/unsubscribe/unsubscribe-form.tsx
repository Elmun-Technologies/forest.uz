'use client';

import { Button } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { useHydrated } from '@/lib/use-hydrated';

/** Confirms the marketing opt-out (`POST /api/messaging/unsubscribe`); service messages stay on. */
export function UnsubscribeForm({ token }: { token: string }) {
  const t = useTranslations('unsubscribe');
  const hydrated = useHydrated();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState('busy');
    setError(null);
    try {
      await clientApi.messaging.unsubscribe(token);
      setState('done');
    } catch (e) {
      setState('idle');
      setError(e instanceof ClientApiError ? e.message : t('failed'));
    }
  }

  if (state === 'done')
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="rounded-sm bg-good-bg px-4 py-3 text-[15px] font-semibold text-good">
          {t('done')}
        </p>
        <p className="text-[13px] text-muted">{t('doneNote')}</p>
        <Link href={routes.home} prefetch={false} className="text-[15px] font-semibold underline">
          {t('home')}
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        variant="brand"
        loading={state === 'busy'}
        disabled={!hydrated || state === 'busy'}
        onClick={() => void confirm()}
        data-testid="unsubscribe-confirm"
      >
        {t('confirm')}
      </Button>
      <p className="text-[13px] text-muted">{t('serviceNote')}</p>
      <p role="alert" className="text-[13px] font-medium text-danger">
        {error}
      </p>
    </div>
  );
}
