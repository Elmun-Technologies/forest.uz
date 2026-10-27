'use client';

import type { MeDto } from '@forest/contracts';
import { cn } from '@forest/ui';
import { Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthErrorMessage } from '@/components/auth/use-after-login';
import { clientApi } from '@/lib/client-api';
import { onIdle } from '@/lib/idle';
import {
  isBotUsername,
  mountTelegramWidget,
  type TelegramAuthPayload,
} from '@/lib/telegram-widget';

type Status = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Telegram Login Widget island (design: Kirish "Telegram orqali kirish"; Kabinet settings link).
 * The third-party script is injected only here, on idle or on the first pointer/focus on the
 * placeholder, into a fixed-height slot. `onauth` → POST `/auth/telegram` (login) or
 * `/me/telegram/link` (link) → `onSuccess` with the fresh `/me`. Render it only when the API
 * reports a bot (`settings.auth.telegramBot`).
 */
export function TelegramLogin({
  bot,
  mode,
  onSuccess,
}: {
  bot: string;
  mode: 'login' | 'link';
  onSuccess: (me: MeDto) => void | Promise<void>;
}) {
  const t = useTranslations('telegram');
  const locale = useLocale();
  const errorMessage = useAuthErrorMessage();
  const slot = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref: the widget calls whatever function was registered when it mounted.
  const authRef = useRef<(user: TelegramAuthPayload) => void>(() => undefined);
  useEffect(() => {
    authRef.current = (user) => {
      setBusy(true);
      setError(null);
      const call = mode === 'login' ? clientApi.auth.telegram : clientApi.me.linkTelegram;
      call(user)
        .then((me) => onSuccess(me))
        .then(() => setBusy(false))
        .catch((e: unknown) => {
          setError(errorMessage(e));
          setBusy(false);
        });
    };
  });

  const load = useCallback(() => {
    if (cleanup.current || !slot.current || !isBotUsername(bot)) return;
    setStatus('loading');
    cleanup.current = mountTelegramWidget(slot.current, {
      bot,
      lang: locale,
      onAuth: (user) => authRef.current(user),
      onLoad: () => setStatus('ready'),
      onError: () => {
        setStatus('failed');
        setError(t('loadFailed'));
      },
    });
  }, [bot, locale, t]);

  useEffect(() => {
    const cancel = onIdle(load, 3000);
    return () => {
      cancel();
      cleanup.current?.();
      cleanup.current = null;
    };
  }, [load]);

  if (!isBotUsername(bot)) return null;
  const label = mode === 'login' ? t('login') : t('link');

  return (
    <div className="flex flex-col gap-2" data-testid="telegram-login">
      <div className="relative min-h-12" aria-busy={status === 'loading' || busy}>
        {/* Rendered without React children: the widget script replaces itself with an iframe. */}
        <div
          ref={slot}
          data-testid="telegram-widget-slot"
          className={cn(
            'flex min-h-12 items-center justify-center',
            status !== 'ready' && 'invisible',
            busy && 'pointer-events-none opacity-50',
          )}
        />
        {status === 'ready' ? null : (
          <button
            type="button"
            onPointerEnter={load}
            onFocus={load}
            onClick={load}
            disabled={status === 'failed'}
            className="absolute inset-0 inline-flex items-center justify-center gap-2.5 rounded-pill border-[1.5px] border-ink text-[15px] font-semibold disabled:opacity-50"
          >
            <Send size={18} aria-hidden />
            {label}
          </button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {busy ? t('checking') : status === 'ready' ? t('ready', { label }) : ''}
      </p>
      <p
        role="alert"
        aria-live="assertive"
        data-testid="telegram-error"
        className="text-[13px] font-medium text-danger empty:hidden"
      >
        {error}
      </p>
    </div>
  );
}
