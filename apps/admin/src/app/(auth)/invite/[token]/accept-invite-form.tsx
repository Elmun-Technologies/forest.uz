'use client';

import { type AdminMeDto, passwordProblems } from '@forest/contracts/core';
import { Button, cn, Field, Input } from '@forest/ui';
import { type FormEvent, useState } from 'react';
import { FormError } from '../../../../components/auth-card';
import { adminFetch, errorText } from '../../../../lib/client-api';
import { PASSWORD_PROBLEM } from '../../../../lib/copy';
import { nextPathFor } from '../../../../lib/stage';

const RULES = ['too_short', 'contains_name', 'too_common'] as const;

export function AcceptInviteForm({
  token,
  email,
  name,
}: {
  token: string;
  email: string;
  name: string;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Same rule as the API (shared from contracts), so the checklist never disagrees with it.
  const problems = passwordProblems(password, { email, name });
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length || confirm !== password) return;
    setBusy(true);
    setError(null);
    try {
      const me = await adminFetch<AdminMeDto>('/admin/auth/accept-invite', {
        method: 'POST',
        body: { token, password },
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
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field label="Yangi parol">
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </Field>
      <ul className="flex flex-col gap-1 text-[13px]" aria-label="Parol talablari">
        {RULES.map((r) => {
          const ok = password.length > 0 && !problems.includes(r);
          return (
            <li key={r} className={cn('flex items-center gap-2', ok ? 'text-good' : 'text-muted')}>
              <span aria-hidden>{ok ? '✓' : '•'}</span>
              {PASSWORD_PROBLEM[r]}
            </li>
          );
        })}
      </ul>
      <Field label="Parolni takrorlang" error={mismatch ? 'Parollar bir xil emas.' : null}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        )}
      </Field>
      <Button
        type="submit"
        size="lg"
        block
        loading={busy}
        disabled={problems.length > 0 || confirm !== password}
      >
        Parolni saqlash
      </Button>
    </form>
  );
}
