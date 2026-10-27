'use client';

import type { MeDto } from '@forest/contracts';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { TelegramLogin } from '@/components/auth/telegram-login';
import { useToast } from '@/components/ui/toast';

/**
 * Kabinet → Sozlamalar "Telegram'ni bog'lash": shows the linked account, or the login widget in
 * link mode (POST /me/telegram/link) when the API has a bot. Hidden when neither applies.
 */
export function TelegramLink({
  telegram,
  bot,
}: {
  telegram: MeDto['telegram'];
  bot: string | null;
}) {
  const t = useTranslations('account');
  const toast = useToast();
  const router = useRouter();
  if (!telegram && !bot) return null;

  return (
    <section
      aria-labelledby="telegram-title"
      data-testid="telegram-link"
      className="flex flex-col gap-4 rounded-lg bg-panel p-6 lg:rounded-xl lg:p-10"
    >
      <h2 id="telegram-title" className="text-2xl font-medium tracking-[-0.03em]">
        {t('telegramTitle')}
      </h2>
      {telegram ? (
        <p className="flex flex-wrap items-center gap-3 text-[15px]">
          <span className="grid size-10 place-items-center rounded-pill bg-sage" aria-hidden>
            <Send size={18} className="text-telegram" />
          </span>
          <span className="flex flex-col">
            <b className="font-semibold">{t('telegramLinked')}</b>
            <span className="text-sm text-muted" data-testid="telegram-username" data-private>
              {telegram.username ? `@${telegram.username}` : t('telegramNoUsername')}
            </span>
          </span>
        </p>
      ) : bot ? (
        <>
          <p className="text-sm text-muted">{t('telegramHint')}</p>
          <div className="max-w-[360px]">
            <TelegramLogin
              bot={bot}
              mode="link"
              onSuccess={() => {
                toast(t('telegramDone'), 'good');
                router.refresh();
              }}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
