'use client';

import { Button, cn } from '@forest/ui';
import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { logoAlt, logos } from '@/components/ui/brand-logos';
import { Logo } from '@/components/ui/logo';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { useHydrated } from '@/lib/use-hydrated';

type Online = 'PAYME' | 'CLICK';

/**
 * "To'lov yakunlanmadi" (Holatlar · 1): the order and its reservation are kept; the customer
 * picks Payme or Click again and is sent to the provider (POST /orders/:publicId/pay).
 */
export function RetryPayment({
  publicId,
  number,
  method,
  failed,
  until,
}: {
  publicId: string;
  number: string;
  method: Online;
  failed: boolean;
  /** Reservation deadline, already formatted ("Bugun, 13:26"). */
  until: string;
}) {
  const t = useTranslations('order');
  const tc = useTranslations('common');
  const [choice, setChoice] = useState<Online>(method);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await clientApi.orders.pay(publicId, choice);
      window.location.assign(url);
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof ClientApiError && e.code === 'NETWORK'
          ? tc('network')
          : e instanceof ClientApiError && e.status < 500
            ? e.message
            : t('retryFailed'),
      );
    }
  }

  const b = (chunks: React.ReactNode) => <b>{chunks}</b>;
  return (
    <section
      data-testid="payment-retry"
      aria-labelledby="pay-title"
      className="flex flex-col gap-[18px] rounded-[36px] bg-panel p-6 text-ink lg:p-8"
    >
      {failed ? (
        <span className="self-start rounded-pill bg-critical-bg px-3 py-1.5 text-xs font-bold text-critical">
          {t('failedBadge')}
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          'grid size-16 place-items-center rounded-pill',
          failed ? 'bg-critical-bg text-critical' : 'bg-sage-50 text-forest',
        )}
      >
        <CreditCard size={28} />
      </span>
      <h2 id="pay-title" className="text-[30px] font-medium tracking-[-0.03em]">
        {failed ? t('failedTitle') : t('pendingTitle')}
      </h2>
      <p className="text-[15px] leading-relaxed text-ink-2">
        {t.rich(failed ? 'failedText' : 'pendingText', { number, time: until, b })}
      </p>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">{t('methodPicker')}</legend>
        {(['PAYME', 'CLICK'] as const).map((m) => (
          <label
            key={m}
            className={cn(
              'grid min-h-14 cursor-pointer place-items-center rounded-[16px] p-3.5 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-forest',
              choice === m ? 'border-2 border-ink' : 'border border-line hover:border-ink',
            )}
          >
            <input
              type="radio"
              name="retry-method"
              value={m}
              checked={choice === m}
              onChange={() => setChoice(m)}
              className="sr-only"
            />
            <Logo src={logos.light[m]} alt={logoAlt[m]} className="h-5" />
          </label>
        ))}
      </fieldset>
      <Button
        size="lg"
        block
        loading={busy}
        disabled={!hydrated}
        onClick={() => void pay()}
        data-testid="retry-pay"
      >
        {t(failed ? 'payAgain' : 'payNow', { method: logoAlt[choice] })}
      </Button>
      <p role="alert" className={cn('text-[13px] font-medium text-danger', !error && 'sr-only')}>
        {error}
      </p>
    </section>
  );
}
