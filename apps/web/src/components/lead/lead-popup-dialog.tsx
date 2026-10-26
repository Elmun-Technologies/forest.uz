'use client';

import type { ImageDto } from '@forest/contracts';
import { Button, PhoneInput } from '@forest/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Link } from '@/i18n/navigation';
import { telegramUrl } from '@/config/site';
import { TelegramIcon } from '@/components/layout/icons';
import { useLead } from './use-lead';

export default function LeadPopupDialog({
  open,
  onOpenChange,
  telegramBot,
  before,
  after,
  fallback,
}: {
  fallback: ImageDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  telegramBot: string | null;
  before: ImageDto | null;
  after: ImageDto | null;
}) {
  const t = useTranslations('popup');
  const tl = useTranslations('lead');
  const tc = useTranslations('common');
  const lead = useLead('popup');
  const errId = useId();
  const tgLink =
    lead.result?.telegramDeepLink ?? (telegramBot ? telegramUrl(telegramBot, 'popup') : null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/55 backdrop-blur-[6px]" />
        <Dialog.Content
          data-testid="lead-popup"
          className="fixed inset-x-3 bottom-3 z-[70] flex max-h-[calc(100dvh-24px)] overflow-hidden rounded-lg bg-panel focus:outline-none md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:h-[560px] md:w-[min(960px,calc(100vw-48px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl"
        >
          <div className="relative hidden flex-1 bg-forest md:block">
            {before && after ? (
              <>
                <Image
                  src={before.url}
                  alt=""
                  fill
                  sizes="480px"
                  className="object-cover object-[50%_62%] [clip-path:inset(0_50%_0_0)]"
                />
                <Image
                  src={after.url}
                  alt={t('imageAlt')}
                  fill
                  sizes="480px"
                  className="object-cover object-[50%_62%] [clip-path:inset(0_0_0_50%)]"
                />
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 -ml-[1.5px] w-[3px] bg-white"
                />
              </>
            ) : fallback ? (
              <Image src={fallback.url} alt="" fill sizes="480px" className="object-cover" />
            ) : null}
            <span className="absolute bottom-6 left-6 rounded-pill bg-white px-4 py-2.5 text-sm font-bold">
              {t('badge')}
            </span>
          </div>
          <div className="relative flex flex-1 flex-col justify-center gap-[22px] overflow-y-auto p-6 md:p-12">
            <Dialog.Close
              aria-label={tc('close')}
              className="absolute top-4 right-4 grid size-11 place-items-center rounded-pill bg-canvas md:top-5 md:right-5"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </Dialog.Close>
            {lead.result ? (
              <div className="flex flex-col items-start gap-5">
                <span className="grid size-[72px] place-items-center rounded-pill bg-forest text-white">
                  <Check size={32} strokeWidth={2.4} aria-hidden />
                </span>
                <Dialog.Title className="text-[32px] leading-[1.05] font-medium tracking-[-0.04em] md:text-[40px]">
                  {t('doneTitle')}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  {tl('sent', { code: lead.result.promoCode })}
                </Dialog.Description>
                <span className="rounded-sm bg-canvas px-5 py-3.5 text-2xl font-bold tracking-[0.08em]">
                  {lead.result.promoCode}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="lg">
                    <Link href="/#tanlash" onClick={() => onOpenChange(false)}>
                      {t('doneCta')}
                    </Link>
                  </Button>
                  {lead.result.telegramDeepLink ? (
                    <Button asChild size="lg" variant="secondary">
                      <a href={lead.result.telegramDeepLink} data-track="telegram_click">
                        <TelegramIcon />
                        {tl('openTelegram')}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void lead.submit();
                }}
                className="flex flex-col gap-[22px]"
              >
                <Dialog.Title className="pr-12 text-[32px] leading-[1.02] font-medium tracking-[-0.04em] md:text-[44px]">
                  {t('title')}
                </Dialog.Title>
                <Dialog.Description className="text-base leading-relaxed text-muted">
                  {t('text')}
                </Dialog.Description>
                <div className="flex flex-col gap-2">
                  <PhoneInput
                    aria-label={tc('phone')}
                    value={lead.digits}
                    onValueChange={lead.setDigits}
                    aria-invalid={lead.error ? true : undefined}
                    aria-describedby={lead.error ? errId : undefined}
                    prefixClassName="left-5 text-base"
                    inputClassName="h-[60px] rounded-pill pl-[76px] text-base"
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
                  className="h-[60px] text-base"
                  data-track="lead_submit"
                >
                  {t('submit')}
                </Button>
                {tgLink ? (
                  <>
                    <span className="flex items-center gap-3 text-[13px] text-muted">
                      <span aria-hidden className="h-px flex-1 bg-line" />
                      {t('or')}
                      <span aria-hidden className="h-px flex-1 bg-line" />
                    </span>
                    <Button asChild variant="secondary" size="lg" className="h-14 border-[1.5px]">
                      <a href={tgLink} data-track="telegram_click">
                        <TelegramIcon />
                        {t('telegram')}
                      </a>
                    </Button>
                  </>
                ) : null}
                <p className="text-xs text-muted">{t('note')}</p>
              </form>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
