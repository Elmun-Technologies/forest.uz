'use client';

import { PhoneInput } from '@forest/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useLead } from './use-lead';

/** Footer "Yangiliklar uchun telefon" → lead with source `footer`. */
export function FooterSubscribe() {
  const t = useTranslations('footer');
  const tc = useTranslations('common');
  const lead = useLead('footer');
  const errId = useId();
  if (lead.result) {
    return (
      <p role="status" className="rounded-pill bg-dark-2 px-5 py-3 text-sm text-white">
        {t('subscribed')}
      </p>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void lead.submit();
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 rounded-pill bg-dark-2 py-1.5 pr-1.5 pl-2 focus-within:outline-3 focus-within:outline-white">
        <PhoneInput
          aria-label={tc('phone')}
          value={lead.digits}
          onValueChange={lead.setDigits}
          placeholder={t('subscribePlaceholder')}
          aria-invalid={lead.error ? true : undefined}
          aria-describedby={lead.error ? errId : undefined}
          className="min-w-0 flex-1"
          prefixClassName="text-on-dark-subtle text-sm"
          inputClassName="h-10 border-0 bg-transparent pl-14 text-sm text-white placeholder:text-on-dark-subtle focus:outline-none"
        />
        <button
          type="submit"
          disabled={lead.pending}
          data-track="lead_submit"
          className="rounded-pill bg-white px-[18px] py-2.5 text-[13px] font-semibold text-ink disabled:opacity-60"
        >
          {t('subscribe')}
        </button>
      </div>
      {lead.error ? (
        <p id={errId} role="alert" className="px-5 text-[13px] font-medium text-[#F2B8B5]">
          {lead.error}
        </p>
      ) : null}
    </form>
  );
}
