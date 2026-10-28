'use client';

import {
  API_KEY_POLICY,
  API_KEY_SCOPES,
  type ApiKeyCreatedDto,
  type ApiKeyDto,
  type ApiKeyScope,
} from '@forest/contracts/core';
import { Badge, Button, Field, Input, Panel } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatLastSeen, formatWhen } from '../../lib/format';
import { FormError } from '../auth-card';
import { ConfirmDialog } from '../customers/confirm-dialog';
import { SCOPE_LABEL } from './copy';
import { SecretOnce } from './secret-once';

/**
 * `/integrations/api-keys`: partner REST keys (n8n/Make/Zapier). Shown once on create, stored as a
 * hash; revoke is immediate. Create/revoke need `integrations.keys` (Owner).
 */
export function ApiKeysManager({
  keys,
  canKeys,
  apiBase,
}: {
  keys: ApiKeyDto[];
  canKeys: boolean;
  apiBase: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    scopes: ['products:read'] as ApiKeyScope[],
    rateLimitPerMin: API_KEY_POLICY.defaultRatePerMin as number,
  });
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminFetch<ApiKeyCreatedDto>('/admin/api-keys', {
        method: 'POST',
        body: form,
      });
      setCreated(r.secret);
      setForm({ ...form, name: '' });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/api-keys/${revoking.id}/revoke`, { method: 'POST' });
      setRevoking(null);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {created ? (
        <SecretOnce label="Yangi API kalit" value={created} onDone={() => setCreated(null)} />
      ) : null}
      <Panel className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <h2 className="text-xl font-semibold">API kalitlar</h2>
        <p className="text-muted">
          Faqat o&apos;qish uchun:{' '}
          <code className="font-mono">GET {apiBase}/v1/partner/products</code>,{' '}
          <code className="font-mono">/v1/partner/stock</code>. So&apos;rovda{' '}
          <code className="font-mono">Authorization: Bearer &lt;kalit&gt;</code>. Mijozlar
          ma&apos;lumoti berilmaydi.
        </p>
        {canKeys ? (
          <form
            onSubmit={create}
            className="flex flex-col gap-3 rounded-md bg-off p-4"
            aria-label="Yangi API kalit"
          >
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <Field label="Nomi">
                {(p) => (
                  <Input
                    {...p}
                    className="h-10 text-sm"
                    required
                    maxLength={80}
                    value={form.name}
                    placeholder="n8n, Make…"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Daqiqasiga so'rov">
                {(p) => (
                  <Input
                    {...p}
                    className="h-10 text-sm"
                    type="number"
                    min={1}
                    max={API_KEY_POLICY.maxRatePerMin}
                    value={form.rateLimitPerMin}
                    onChange={(e) => setForm({ ...form, rateLimitPerMin: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="pb-1 text-[13px] font-semibold">Ruxsatlar</legend>
              {API_KEY_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(s)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scopes: e.target.checked
                          ? [...form.scopes, s]
                          : form.scopes.filter((x) => x !== s),
                      })
                    }
                  />
                  {SCOPE_LABEL[s]}
                </label>
              ))}
            </fieldset>
            <FormError message={revoking ? null : error} />
            <div>
              <Button
                type="submit"
                size="sm"
                loading={busy && !revoking}
                disabled={!form.scopes.length}
              >
                Kalit yaratish
              </Button>
            </div>
          </form>
        ) : null}

        {keys.length === 0 ? (
          <p className="py-6 text-center text-muted">Hali API kalit yo&apos;q.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]" data-testid="api-keys">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Nomi</th>
                  <th className="py-2 font-medium">Kalit</th>
                  <th className="py-2 font-medium">Ruxsatlar</th>
                  <th className="py-2 font-medium">Limit</th>
                  <th className="py-2 font-medium">Oxirgi foydalanish</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-line-soft">
                    <td className="py-2 font-semibold">{k.name}</td>
                    <td className="py-2 font-mono text-xs">{k.masked}</td>
                    <td className="py-2 text-xs">
                      {k.scopes.map((s) => SCOPE_LABEL[s]).join(', ')}
                    </td>
                    <td className="py-2">{k.rateLimitPerMin}/daq</td>
                    <td className="py-2">{formatLastSeen(k.lastUsedAt)}</td>
                    <td className="py-2 text-right">
                      {k.revokedAt ? (
                        <Badge tone="neutral" title={formatWhen(k.revokedAt)}>
                          Bekor qilingan
                        </Badge>
                      ) : canKeys ? (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(k)}>
                          Bekor qilish
                        </Button>
                      ) : (
                        <Badge tone="good">Faol</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={!!revoking}
        title="Kalit bekor qilinsinmi?"
        confirmLabel="Bekor qilish"
        danger
        busy={busy}
        error={revoking ? error : null}
        onClose={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      >
        <p>
          {revoking?.name} bilan ishlayotgan tizim darhol 401 xato oladi. Bu amalni qaytarib
          bo&apos;lmaydi.
        </p>
      </ConfirmDialog>
    </div>
  );
}
