'use client';

import { TASHKENT_DISTRICTS } from '@forest/contracts/core';
import { Button, cn, Field, Input, inputClasses } from '@forest/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/config/site';
import { useToast } from '@/components/ui/toast';
import { ClientApiError, clientApi } from '@/lib/client-api';

/**
 * "Manzilni o'zgartirish" on the tracking page. Allowed until the parcel is handed to the
 * courier (`canChangeAddress`) and only for the signed-in owner — the link alone isn't identity.
 */
export function ChangeAddress({
  token,
  region,
  district,
  line,
}: {
  token: string;
  region: string;
  district: string | null;
  line: string;
}) {
  const t = useTranslations('track');
  const tc = useTranslations('common');
  const locale = useLocale() as 'uz' | 'ru';
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(line);
  const [dist, setDist] = useState(district ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; login: boolean } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await clientApi.track.changeAddress(token, {
        addressLine: value.trim(),
        district: dist || null,
      });
      toast(t('saved'), 'good');
      setOpen(false);
      router.refresh();
    } catch (err) {
      const unauthorized = err instanceof ClientApiError && err.status === 401;
      setError({
        login: unauthorized,
        message: unauthorized
          ? t('loginToChange')
          : err instanceof ClientApiError && err.code === 'NETWORK'
            ? tc('network')
            : err instanceof ClientApiError && err.status < 500
              ? err.message
              : tc('generic'),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button
        variant="outline"
        className="h-12 flex-[1_1_140px]"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        data-testid="change-address"
      >
        {t('changeAddress')}
      </Button>
    );

  return (
    <form onSubmit={save} className="flex w-full flex-col gap-3" aria-label={t('changeAddress')}>
      {region === 'tashkent_city' ? (
        <Field label={t('district')}>
          {(p) => (
            <select
              {...p}
              value={dist}
              onChange={(e) => setDist(e.target.value)}
              className={cn(inputClasses, 'appearance-auto')}
            >
              <option value="" />
              {TASHKENT_DISTRICTS.map((d) => (
                <option key={d.code} value={d.code}>
                  {d[locale]}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <Field label={t('newAddress')}>
        {(p) => (
          <Input
            {...p}
            required
            minLength={5}
            maxLength={300}
            autoComplete="street-address"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-private
          />
        )}
      </Field>
      <div role="alert" className="text-[13px] font-medium text-danger">
        {error ? (
          <>
            {error.message}{' '}
            {error.login ? (
              <Link
                href={`${routes.login}?next=${encodeURIComponent(`/t/${token}`)}`}
                className="font-semibold text-ink underline"
              >
                {t('login')}
              </Link>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={value.trim().length < 5}>
          {t('save')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
