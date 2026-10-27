'use client';

import { maskUzPhone, parseUzPhone } from '@forest/contracts/core';
import { Button, cn, Field, PhoneInput } from '@forest/ui';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { TelegramLogin } from '@/components/auth/telegram-login';
import { useAfterLogin, useAuthErrorMessage } from '@/components/auth/use-after-login';
import { clientApi } from '@/lib/client-api';
import { useHydrated } from '@/lib/use-hydrated';

const CELLS = 4;

/**
 * Phone → 4-digit SMS code login (design: Kirish), plus "Telegram orqali kirish" when the API has
 * a bot (`telegramBot`). On success the guest cart and favourites are merged into the account
 * (cart by the API, favourites here) and the visitor returns to `next`.
 */
export function LoginForm({ next, telegramBot }: { next: string; telegramBot: string | null }) {
  const t = useTranslations('login');
  const tc = useTranslations('common');
  const afterLogin = useAfterLogin(next);
  const apiMessage = useAuthErrorMessage();
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState<string[]>(Array(CELLS).fill(''));
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const hydrated = useHydrated();

  useEffect(() => {
    if (!sentTo) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sentTo]);

  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function send(ev?: FormEvent) {
    ev?.preventDefault();
    const p = parseUzPhone(phone);
    if (!p.ok) return setError(tc(`phoneErrors.${p.error}`));
    setBusy(true);
    setError(null);
    try {
      const r = await clientApi.auth.sendOtp(p.e164);
      setSentTo(p.e164);
      setCode(Array(CELLS).fill(''));
      setResendAt(Date.now() + r.resendInSec * 1000);
      setNow(Date.now());
      window.setTimeout(() => cells.current[0]?.focus(), 0);
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(digits = code.join('')) {
    if (!sentTo) return;
    if (digits.length < CELLS) return setError(t('codeIncomplete'));
    setBusy(true);
    setError(null);
    try {
      await clientApi.auth.verifyOtp(sentTo, digits);
      await afterLogin();
    } catch (e) {
      setBusy(false);
      setError(apiMessage(e));
      setCode(Array(CELLS).fill(''));
      cells.current[0]?.focus();
    }
  }

  function fill(from: number, digits: string) {
    const nextCode = [...code];
    for (let i = 0; i < digits.length && from + i < CELLS; i++) nextCode[from + i] = digits[i]!;
    setCode(nextCode);
    const filled = nextCode.join('');
    if (filled.length === CELLS && !nextCode.includes('')) void verify(filled);
    else cells.current[Math.min(CELLS - 1, from + digits.length)]?.focus();
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      const nextCode = [...code];
      nextCode[i - 1] = '';
      setCode(nextCode);
      cells.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) cells.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < CELLS - 1) cells.current[i + 1]?.focus();
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!digits) return;
    e.preventDefault();
    fill(i, digits);
  }

  return (
    <div className="flex max-w-[440px] flex-col gap-6 lg:gap-8">
      <form onSubmit={send} noValidate className="flex flex-col gap-6 lg:gap-8">
        <Field label={t('phone')}>
          {(p) => (
            <PhoneInput
              {...p}
              value={phone}
              onValueChange={(v) => {
                setPhone(v);
                if (sentTo) setSentTo(null);
              }}
              readOnly={busy || !hydrated}
              data-testid="login-phone"
              className="[&_input]:h-[58px] [&_input]:rounded-[20px] [&_input]:text-[17px]"
            />
          )}
        </Field>
        {sentTo ? null : (
          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            disabled={!hydrated}
            data-testid="login-send"
            className="h-16 text-base"
          >
            {t('getCode')}
          </Button>
        )}
      </form>

      {sentTo ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="flex flex-col gap-6 lg:gap-8"
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-[13px] font-semibold">
              {t('code')}{' '}
              <span className="font-normal text-muted">
                {t('sentTo', { phone: maskUzPhone(sentTo) })}
              </span>
            </legend>
            <div className="flex gap-2.5">
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    cells.current[i] = el;
                  }}
                  aria-label={t('digit', { n: i + 1 })}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  pattern="[0-9]*"
                  maxLength={CELLS}
                  value={d}
                  data-testid={`otp-${i}`}
                  onChange={(e) => {
                    // Every cell accepts a pasted/autofilled code; typing over a filled cell replaces it.
                    let v = e.target.value.replace(/\D/g, '');
                    if (d && v.length === 2 && v.startsWith(d)) v = v.slice(1);
                    if (v) return fill(i, v);
                    const nextCode = [...code];
                    nextCode[i] = '';
                    setCode(nextCode);
                  }}
                  onKeyDown={(e) => onKey(i, e)}
                  onPaste={(e) => onPaste(i, e)}
                  className={cn(
                    'h-20 w-[72px] rounded-[20px] text-center text-[32px] font-semibold focus:outline-none focus-visible:outline-3 focus-visible:outline-forest',
                    d ? 'border-2 border-ink' : 'border border-line',
                  )}
                />
              ))}
            </div>
            <p className="text-[13px] text-muted">
              {left > 0 ? (
                t.rich('resendIn', {
                  time: `0:${String(left).padStart(2, '0')}`,
                  b: (c) => <b className="tabular text-ink">{c}</b>,
                })
              ) : (
                <button
                  type="button"
                  onClick={() => void send()}
                  className="min-h-11 font-semibold text-ink underline"
                >
                  {t('resend')}
                </button>
              )}
            </p>
          </fieldset>
          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            data-testid="login-verify"
            className="h-16 text-base"
          >
            {t('confirm')}
          </Button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
            className="-mt-3 self-start text-[13px] text-muted underline"
          >
            {t('changePhone')}
          </button>
        </form>
      ) : null}

      <p role="alert" aria-live="assertive" className="text-[13px] font-medium text-danger">
        {error}
      </p>

      {telegramBot ? (
        <>
          <div aria-hidden className="flex items-center gap-4 text-[13px] text-muted">
            <span className="h-px flex-1 bg-line" />
            {t('or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          <TelegramLogin bot={telegramBot} mode="login" onSuccess={afterLogin} />
        </>
      ) : null}
    </div>
  );
}
