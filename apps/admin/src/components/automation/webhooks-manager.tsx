'use client';

import {
  WEBHOOK_EVENTS,
  WEBHOOK_POLICY,
  type WebhookDeliveryPageDto,
  type WebhookEndpointDto,
  type WebhookEvent,
  type WebhookListDto,
  type WebhookSecretDto,
  type WebhookTestResultDto,
} from '@forest/contracts/core';
import { Badge, Button, Field, Input, Panel, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { FormError } from '../auth-card';
import { ConfirmDialog } from '../customers/confirm-dialog';
import { DELIVERY_STATUS, EVENT_LABEL } from './copy';
import { SecretOnce } from './secret-once';

function EventPicker({
  value,
  onChange,
  disabled,
}: {
  value: WebhookEvent[];
  onChange: (v: WebhookEvent[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1 text-[13px] font-semibold">Hodisalar</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={value.includes(e)}
              disabled={disabled}
              onChange={(ev) =>
                onChange(ev.target.checked ? [...value, e] : value.filter((x) => x !== e))
              }
            />
            <code className="font-mono text-xs">{e}</code>
            <span className="text-muted">· {EVENT_LABEL[e]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * `/integrations/webhooks`: endpoints (create, events, on/off, test, rotate secret, delete) and the
 * delivery log. Editing needs `integrations.keys` (Owner); the API enforces it.
 */
export function WebhooksManager({ list, canKeys }: { list: WebhookListDto; canKeys: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', events: [] as WebhookEvent[] });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const r = await adminFetch<WebhookSecretDto>('/admin/webhooks', {
        method: 'POST',
        body: form,
      });
      setSecret({ label: `${r.endpoint.host} uchun imzo kaliti`, value: r.secret });
      setCreating(false);
      setForm({ name: '', url: '', events: [] });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {secret ? (
        <SecretOnce label={secret.label} value={secret.value} onDone={() => setSecret(null)} />
      ) : null}

      <Panel className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Webhook manzillari</h2>
          {canKeys && !creating && list.items.length < WEBHOOK_POLICY.maxEndpoints ? (
            <Button size="sm" onClick={() => setCreating(true)} data-testid="webhook-new">
              + Webhook qo&apos;shish
            </Button>
          ) : null}
        </div>
        <p className="text-muted">
          Har bir so&apos;rov <code className="font-mono">X-Forest-Signature</code> (HMAC-SHA256,
          vaqt belgisi bilan) orqali imzolanadi. Javob 2xx bo&apos;lmasa, 8 martagacha qayta
          yuboriladi; ketma-ket {WEBHOOK_POLICY.autoDisableAfter} ta muvaffaqiyatsiz yetkazishdan
          keyin manzil avtomatik o&apos;chiriladi. Ma&apos;lumotda mijoz ismi, telefoni va manzili
          yo&apos;q.
        </p>

        {creating ? (
          <form
            onSubmit={create}
            className="flex flex-col gap-3 rounded-md bg-off p-4"
            aria-label="Yangi webhook"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Nomi">
                {(p) => (
                  <Input
                    {...p}
                    className="h-10 text-sm"
                    value={form.name}
                    maxLength={80}
                    placeholder="n8n, Google Sheets…"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Manzil (URL)" hint="https:// bilan boshlanadigan ochiq manzil">
                {(p) => (
                  <Input
                    {...p}
                    className="h-10 text-sm"
                    type="url"
                    required
                    value={form.url}
                    maxLength={500}
                    placeholder="https://"
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <EventPicker value={form.events} onChange={(events) => setForm({ ...form, events })} />
            <FormError message={error} />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                loading={busy === 'create'}
                disabled={!form.events.length}
              >
                Saqlash
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Bekor qilish
              </Button>
            </div>
          </form>
        ) : null}

        {list.items.length === 0 ? (
          <p className="py-6 text-center text-muted">Hali webhook qo&apos;shilmagan.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft" data-testid="webhook-list">
            {list.items.map((w) => (
              <EndpointRow
                key={w.id}
                w={w}
                canKeys={canKeys}
                expanded={open === w.id}
                onToggle={() => setOpen(open === w.id ? null : w.id)}
                onSecret={(value) =>
                  setSecret({ label: `${w.host} uchun yangi imzo kaliti`, value })
                }
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function EndpointRow({
  w,
  canKeys,
  expanded,
  onToggle,
  onSecret,
}: {
  w: WebhookEndpointDto;
  canKeys: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSecret: (value: string) => void;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<WebhookEvent[]>(w.events);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<WebhookTestResultDto | null>(null);
  const [log, setLog] = useState<WebhookDeliveryPageDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: object) =>
    act('patch', async () => {
      await adminFetch(`/admin/webhooks/${w.id}`, { method: 'PATCH', body });
      router.refresh();
    });

  const loadLog = () =>
    act('log', async () =>
      setLog(
        await adminFetch<WebhookDeliveryPageDto>(`/admin/webhooks/${w.id}/deliveries?limit=30`),
      ),
    );

  return (
    <li className="flex flex-col gap-3 py-3" data-testid={`webhook-${w.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex min-w-0 flex-col">
          <b className="font-semibold">{w.name || w.host}</b>
          <span className="truncate font-mono text-xs text-muted">{w.url}</span>
        </div>
        <span className="text-xs text-muted" title="Oxirgi 24 soat">
          24 soat: <b className="text-good">{w.stats24h.delivered}</b> ·{' '}
          <b className="text-critical">{w.stats24h.failed}</b> xato · {w.stats24h.pending} navbatda
        </span>
        {w.active ? (
          <Badge tone="good">Faol</Badge>
        ) : (
          <Badge tone="warn" title={w.disabledReason ?? undefined}>
            {w.disabledAt ? "Avtomatik o'chirilgan" : "O'chirilgan"}
          </Badge>
        )}
        <Button size="sm" variant="outline" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Yopish' : 'Batafsil'}
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 rounded-md bg-off p-4">
          <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-1 text-xs">
            <dt className="text-muted">Imzo kaliti</dt>
            <dd className="font-mono">{w.secretMasked}</dd>
            <dt className="text-muted">Qo&apos;shilgan</dt>
            <dd>{formatWhen(w.createdAt)}</dd>
            {w.disabledReason ? (
              <>
                <dt className="text-muted">O&apos;chirilish sababi</dt>
                <dd>{w.disabledReason}</dd>
              </>
            ) : null}
          </dl>
          <EventPicker value={events} onChange={setEvents} disabled={!canKeys} />
          {canKeys ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!events.length || events.join() === w.events.join()}
                loading={busy === 'patch'}
                onClick={() => void patch({ events })}
              >
                Hodisalarni saqlash
              </Button>
              <span className="flex items-center gap-2 text-[13px]">
                <Switch
                  checked={w.active}
                  aria-label="Faol"
                  onCheckedChange={(v) => void patch({ active: v })}
                />
                Faol
              </span>
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'test'}
                data-testid="webhook-test"
                onClick={() =>
                  void act('test', async () => {
                    setTest(
                      await adminFetch<WebhookTestResultDto>(`/admin/webhooks/${w.id}/test`, {
                        method: 'POST',
                      }),
                    );
                    router.refresh();
                  })
                }
              >
                Sinov yuborish
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'rotate'}
                onClick={() =>
                  void act('rotate', async () => {
                    if (!window.confirm('Eski kalit darhol ishlamay qoladi. Davom etasizmi?'))
                      return;
                    const r = await adminFetch<WebhookSecretDto>(
                      `/admin/webhooks/${w.id}/rotate-secret`,
                      { method: 'POST' },
                    );
                    onSecret(r.secret);
                  })
                }
              >
                Kalitni yangilash
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                O&apos;chirish
              </Button>
            </div>
          ) : null}
          {test ? (
            <p
              role="status"
              className={test.ok ? 'text-good' : 'text-critical'}
              data-testid="webhook-test-result"
            >
              {test.ok
                ? `Sinov yetkazildi: HTTP ${test.statusCode} (${test.durationMs} ms)`
                : `Sinov yetkazilmadi: ${test.error ?? `HTTP ${test.statusCode}`}`}
            </p>
          ) : null}
          <FormError message={error} />
          <div>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'log'}
              onClick={() => void loadLog()}
            >
              Yetkazish jurnali →
            </Button>
          </div>
          {log ? (
            log.items.length === 0 ? (
              <p className="text-muted">Hali yetkazish bo&apos;lmagan.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1 font-medium">Vaqt</th>
                      <th className="py-1 font-medium">Hodisa</th>
                      <th className="py-1 font-medium">Holat</th>
                      <th className="py-1 font-medium">Urinish</th>
                      <th className="py-1 font-medium">Javob</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {log.items.map((d) => (
                      <tr key={d.id} className="border-t border-line-soft">
                        <td className="py-1.5">{formatWhen(d.createdAt)}</td>
                        <td className="py-1.5 font-mono">{d.event}</td>
                        <td className="py-1.5">
                          <Badge tone={DELIVERY_STATUS[d.status].tone} className="h-5 text-[11px]">
                            {DELIVERY_STATUS[d.status].label}
                          </Badge>
                        </td>
                        <td className="py-1.5">{d.attempts}</td>
                        <td className="py-1.5">
                          {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : (d.lastError ?? '—')}
                          {d.durationMs !== null ? ` · ${d.durationMs} ms` : ''}
                        </td>
                        <td className="py-1.5 text-right">
                          {canKeys && d.status === 'FAILED' && d.event !== 'webhook.test' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void act('redeliver', async () => {
                                  await adminFetch(
                                    `/admin/webhooks/${w.id}/deliveries/${d.id}/redeliver`,
                                    { method: 'POST' },
                                  );
                                  await loadLog();
                                })
                              }
                            >
                              Qayta yuborish
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Webhook o'chirilsinmi?"
        confirmLabel="O'chirish"
        danger
        busy={busy === 'delete'}
        error={confirmDelete ? error : null}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          void act('delete', async () => {
            await adminFetch(`/admin/webhooks/${w.id}`, { method: 'DELETE' });
            setConfirmDelete(false);
            router.refresh();
          })
        }
      >
        <p>
          {w.host} manziliga hodisalar yuborilmay qoladi; yetkazish jurnali ham o&apos;chiriladi.
        </p>
      </ConfirmDialog>
    </li>
  );
}
