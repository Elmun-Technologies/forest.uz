'use client';

import type { AdminMeDto } from '@forest/contracts/core';
import { Button, Field, Input } from '@forest/ui';
import { type FormEvent, useState } from 'react';
import { FormError } from '../../../components/auth-card';
import { adminFetch, errorText } from '../../../lib/client-api';
import { nextPathFor } from '../../../lib/stage';

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const me = await adminFetch<AdminMeDto>('/admin/auth/login', {
        method: 'POST',
        body: {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        },
      });
      // Full navigation: server components must see the new session cookie.
      window.location.assign(nextPathFor(me));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <Field label="Email">
        {(p) => (
          <Input
            {...p}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
          />
        )}
      </Field>
      <Field label="Parol">
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="current-password" required />
        )}
      </Field>
      <Button type="submit" size="lg" block loading={busy}>
        Kirish
      </Button>
    </form>
  );
}
