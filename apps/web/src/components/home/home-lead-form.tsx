'use client';

import { Button, PhoneInput } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { TelegramIcon } from '@/components/layout/icons';
import { useLead } from '@/components/lead/use-lead';

export function HomeLeadForm({ telegramUrl }: { telegramUrl: string | null }) {
  const t = useTranslations('home.lead');
  const tl = useTranslations('lead');
  const tc = useTranslations('common');
  const lead = useLead('home');
  const errId = useId();

  if (lead.result) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-md bg-panel p-5">
        <p className="text-base font-medium">{tl('sent', { code: lead.result.promoCode })}</p>
        <span className="rounded-sm bg-canvas px-5 py-3 text-2xl font-bold tracking-[0.08em]">
          {lead.result.promoCode}
        </span>
        {lead.result.telegramDeepLink ? (
          <a
            href={lead.result.telegramDeepLink}
            data-track="telegram_click"
            className="font-semibold underline"
          >
            {tl('openTelegram')}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void lead.submit();
      }}
      className="flex max-w-[640px] flex-col gap-2.5 lg:flex-row lg:flex-wrap"
    >
      <div className="flex flex-col gap-1.5 lg:flex-[1_1_420px]">
        <PhoneInput
          aria-label={tc('phone')}
          value={lead.digits}
          onValueChange={lead.setDigits}
          aria-invalid={lead.error ? true : undefined}
          aria-describedby={lead.error ? errId : undefined}
          prefixClassName="left-[18px] text-base lg:left-[22px]"
          inputClassName="h-[54px] rounded-pill border-white pl-[66px] text-base lg:h-[60px] lg:pl-[76px]"
        />
        {lead.error ? (
          <p id={errId} role="alert" className="px-5 text-[13px] font-medium text-danger">
            {lead.error}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        size="lg"
        loading={lead.pending}
        data-track="lead_submit"
        className="h-[54px] text-[15px] lg:h-[60px] lg:px-7 lg:text-base"
      >
        {t('submit')}
      </Button>
      {telegramUrl ? (
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="hidden h-[60px] border-[1.5px] px-[22px] lg:inline-flex"
        >
          <a href={telegramUrl} data-track="telegram_click">
            <TelegramIcon />
            {t('telegram')}
          </a>
        </Button>
      ) : null}
    </form>
  );
}
