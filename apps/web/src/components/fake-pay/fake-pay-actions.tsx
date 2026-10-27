'use client';

import { Button } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { clientApi } from '@/lib/client-api';
import { useHydrated } from '@/lib/use-hydrated';

/** Simulates the provider's webhook (POST /dev/fake-pay), then returns to the order page. */
export function FakePayActions({ publicId }: { publicId: string }) {
  const t = useTranslations('fakePay');
  const router = useRouter();
  const [busy, setBusy] = useState<'success' | 'fail' | null>(null);
  const [error, setError] = useState(false);
  const hydrated = useHydrated();

  async function finish(result: 'success' | 'fail') {
    setBusy(result);
    setError(false);
    try {
      await clientApi.dev.fakePay(publicId, result);
      router.push(`/buyurtma/${publicId}`);
    } catch {
      setBusy(null);
      setError(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2.5">
        <Button
          size="lg"
          variant="brand"
          className="flex-1"
          loading={busy === 'success'}
          disabled={!hydrated || busy !== null}
          onClick={() => void finish('success')}
          data-testid="fake-pay-success"
        >
          {t('success')}
        </Button>
        <Button
          size="lg"
          variant="danger"
          className="flex-1"
          loading={busy === 'fail'}
          disabled={!hydrated || busy !== null}
          onClick={() => void finish('fail')}
          data-testid="fake-pay-fail"
        >
          {t('fail')}
        </Button>
      </div>
      <p role="alert" className="text-[13px] font-medium text-danger">
        {error ? t('failed') : null}
      </p>
    </div>
  );
}
