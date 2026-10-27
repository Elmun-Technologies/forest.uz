'use client';

import type { AdminMeDto } from '@forest/contracts/core';
import { Button, Field, Input } from '@forest/ui';
import { type FormEvent, useState } from 'react';
import { adminFetch, errorText } from '../lib/client-api';
import { nextPathFor } from '../lib/stage';
import { FormError } from './auth-card';

/** 6-digit authenticator code → `auth/totp/verify` (login step-up or enrolment). */
export function TotpCodeForm({ submitLabel = 'Tasdiqlash' }: { submitLabel?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setError(null);
    try {
      const me = await adminFetch<AdminMeDto>('/admin/auth/totp/verify', {
        method: 'POST',
        body: { code },
      });
      window.location.assign(nextPathFor(me));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <Field label="Ilovadagi 6 xonali kod" hint="Kod har 30 soniyada yangilanadi.">
        {(p) => (
          <Input
            {...p}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            className="tabular text-center text-2xl tracking-[0.4em]"
          />
        )}
      </Field>
      <Button type="submit" size="lg" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
