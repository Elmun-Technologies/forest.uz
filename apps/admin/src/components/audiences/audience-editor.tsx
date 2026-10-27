'use client';

import {
  AUDIENCE_DESTINATIONS,
  type AdminSegmentDto,
  type AdminSegmentListDto,
  type AudienceAutoMessage,
  type AudienceCondition,
  type AudienceDestination,
  type AudienceRules,
  type AudienceSizeDto,
  formatCompactSoum,
  soumToTiyin,
} from '@forest/contracts/core';
import { Badge, Button, Field, Input, Panel, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { FormError } from '../auth-card';
import { Icon } from '../icon';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { COPY, DESTINATION_LABEL, SYNC_LABEL, SYNC_TONE } from './copy';
import { defaultCondition, RuleRow } from './rule-row';

interface Draft {
  name: string;
  description: string;
  rules: AudienceRules;
  destinations: AudienceDestination[];
  autoMessage: AudienceAutoMessage;
  active: boolean;
}

const draftOf = (s: AdminSegmentDto | null): Draft => ({
  name: s?.name ?? '',
  description: s?.description ?? '',
  rules: s?.rules.groups.length
    ? s.rules
    : {
        groups: [
          { conditions: [{ type: 'event', event: 'add_to_cart', did: true, withinDays: 7 }] },
        ],
      },
  destinations: s?.destinations ?? [],
  autoMessage: s?.autoMessage ?? { enabled: false, steps: [] },
  active: s?.active ?? true,
});

/** URL-safe base64 of UTF-8 JSON (the preview GET carries the unsaved rules). */
function b64url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(n).replace(/,/g, ' ');

/** A8 editor (design Admin-Auditoriya): rules, live size, destinations, auto message, result. */
export function AudienceEditor({
  segment,
  list,
}: {
  segment: AdminSegmentDto | null;
  list: AdminSegmentListDto;
}) {
  const router = useRouter();
  const [d, setD] = useState(() => draftOf(segment));
  const [size, setSize] = useState<AudienceSizeDto | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  // Live size of the unsaved rules, debounced; stale answers are dropped.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(() => {
      adminFetch<AudienceSizeDto>(`/admin/audiences/preview?rules=${b64url(d.rules)}`)
        .then((r) => {
          if (id === seq.current) {
            setSize(r);
            setSizeError(null);
          }
        })
        .catch((e: unknown) => {
          if (id === seq.current) setSizeError(errorText(e));
        });
    }, 400);
    return () => clearTimeout(t);
  }, [d.rules]);

  const setGroup = (gi: number, conditions: AudienceCondition[]) =>
    setD((x) => {
      const groups = x.rules.groups
        .map((g, i) => (i === gi ? { conditions } : g))
        .filter((g) => g.conditions.length > 0);
      return { ...x, rules: { groups: groups.length ? groups : x.rules.groups } };
    });

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);
    const body = {
      name: d.name,
      description: d.description.trim() || null,
      rules: d.rules,
      destinations: d.destinations,
      autoMessage: d.autoMessage.steps.length || d.autoMessage.enabled ? d.autoMessage : null,
      active: d.active,
    };
    try {
      const saved = segment
        ? await adminFetch<AdminSegmentDto>(`/admin/audiences/${segment.id}`, {
            method: 'PATCH',
            body,
          })
        : await adminFetch<AdminSegmentDto>('/admin/audiences', { method: 'POST', body });
      setNotice(COPY.saved);
      if (!segment) router.push(`/audiences?id=${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function refreshNow() {
    if (!segment) return;
    setBusy('refresh');
    setError(null);
    try {
      await adminFetch(`/admin/audiences/${segment.id}/refresh`, { method: 'POST' });
      setNotice(COPY.refreshed);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const states = new Map(segment?.destinationStates.map((s) => [s.destination, s]) ?? []);
  const toggleDestination = (dest: AudienceDestination, on: boolean) =>
    setD((x) => ({
      ...x,
      destinations: on ? [...x.destinations, dest] : x.destinations.filter((v) => v !== dest),
    }));
  const result = segment?.result;

  return (
    <form onSubmit={save} className="flex min-w-0 flex-col gap-4" data-testid="audience-editor">
      <Panel as="section" className="flex flex-col gap-4 p-5 text-[13px] sm:p-[26px]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-2xl font-medium tracking-[-0.02em]">
            {segment ? segment.name : 'Yangi auditoriya'}
          </h2>
          <label className="flex items-center gap-2 font-semibold">
            <Switch
              checked={d.active}
              onCheckedChange={(active) => setD((x) => ({ ...x, active }))}
              aria-label="Faol"
            />
            {d.active ? COPY.active : COPY.paused}
          </label>
        </div>
        <FormError message={error} />
        {notice ? (
          <p role="status" className="rounded-sm bg-good-bg px-3 py-2 font-semibold text-good">
            {notice}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={COPY.name}>
            {(p) => (
              <Input
                {...p}
                required
                maxLength={80}
                className="h-10 text-sm"
                value={d.name}
                onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))}
                data-testid="audience-name"
              />
            )}
          </Field>
          <Field label={COPY.description}>
            {(p) => (
              <Input
                {...p}
                maxLength={200}
                className="h-10 text-sm"
                value={d.description}
                onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
              />
            )}
          </Field>
        </div>

        <h3 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          {COPY.rules}
        </h3>
        {d.rules.groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-3">
            {gi > 0 ? (
              <span className="self-start rounded-pill bg-ink px-3 py-1 text-xs font-semibold text-white">
                {COPY.or}
              </span>
            ) : null}
            {g.conditions.map((c, ci) => (
              <RuleRow
                key={ci}
                lead={ci === 0 ? COPY.if : COPY.and}
                condition={c}
                products={list.products}
                onChange={(next) =>
                  setGroup(
                    gi,
                    g.conditions.map((x, i) => (i === ci ? next : x)),
                  )
                }
                onRemove={() =>
                  setGroup(
                    gi,
                    g.conditions.filter((_, i) => i !== ci),
                  )
                }
              />
            ))}
            <button
              type="button"
              className="self-start rounded-md border border-dashed border-line px-3 py-2 font-medium hover:bg-canvas"
              onClick={() =>
                setGroup(gi, [...g.conditions, defaultCondition('consent', list.products)])
              }
              data-testid="audience-add-rule"
            >
              {COPY.addRule}
            </button>
          </div>
        ))}
        {d.rules.groups.length < 5 ? (
          <button
            type="button"
            className="self-start text-[13px] font-semibold text-forest underline"
            onClick={() =>
              setD((x) => ({
                ...x,
                rules: {
                  groups: [
                    ...x.rules.groups,
                    { conditions: [defaultCondition('event', list.products)] },
                  ],
                },
              }))
            }
          >
            {COPY.addGroup}
          </button>
        ) : null}

        <div className="flex flex-wrap items-end gap-6 rounded-md bg-off p-5" aria-live="polite">
          <div className="mr-auto flex flex-col">
            <span className="text-muted">{COPY.size}</span>
            <b className="tabular text-[34px] font-semibold" data-testid="audience-size">
              {size ? fmt(size.total) : '…'}
            </b>
          </div>
          {[
            [COPY.withPhone, size?.withPhone],
            [COPY.withTelegram, size?.withTelegram],
            [COPY.adsReady, size?.adsReady],
          ].map(([label, v]) => (
            <div key={label as string} className="flex flex-col">
              <span className="text-muted">{label}</span>
              <b className="tabular text-lg font-semibold">
                {v === undefined ? '…' : fmt(v as number)}
              </b>
            </div>
          ))}
          <p className="w-full text-xs text-muted">{sizeError ?? COPY.sizeHint}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy !== null} data-testid="audience-save">
            {segment ? COPY.save : COPY.create}
          </Button>
          {segment ? (
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={refreshNow}>
              {COPY.refresh}
            </Button>
          ) : null}
          {segment ? (
            <span className="self-center text-xs text-muted">
              {segment.refreshedAt
                ? `${formatWhen(segment.refreshedAt)} · +${segment.lastAdded} / −${segment.lastRemoved}`
                : COPY.refreshedNever}
              {segment.refreshError ? ` · ${segment.refreshError}` : ''}
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel
        as="section"
        className="flex flex-col gap-1 p-5 text-[13px] sm:p-[26px]"
        aria-labelledby="aud-dest"
      >
        <h2 id="aud-dest" className="mb-2 text-xl font-semibold">
          {COPY.destinations}
        </h2>
        {AUDIENCE_DESTINATIONS.map((dest) => {
          const st = states.get(dest);
          const on = d.destinations.includes(dest);
          const ad = dest !== 'telegram' && dest !== 'sms';
          return (
            <div
              key={dest}
              className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0"
            >
              <div className="mr-auto flex min-w-0 flex-col">
                <b className="text-[15px] font-semibold">{DESTINATION_LABEL[dest].name}</b>
                <span className="text-xs text-muted">{DESTINATION_LABEL[dest].hint}</span>
                {st && ad && (st.enabled || st.members > 0) ? (
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={SYNC_TONE[st.status]}>{SYNC_LABEL[st.status]}</Badge>
                    <span className="text-muted">
                      {fmt(st.members)} kishi
                      {st.lastSyncAt ? ` · ${formatWhen(st.lastSyncAt)}` : ''}
                    </span>
                    {st.lastError ? <span className="text-critical">{st.lastError}</span> : null}
                  </span>
                ) : ad && on && !(st?.connected ?? false) ? (
                  <span className="mt-1 text-xs text-warn">{COPY.notConnected}</span>
                ) : null}
              </div>
              <Switch
                checked={on}
                onCheckedChange={(v) => toggleDestination(dest, v)}
                aria-label={DESTINATION_LABEL[dest].name}
                data-testid={`audience-dest-${dest}`}
              />
            </div>
          );
        })}
        <p className="mt-2 flex gap-2 text-xs text-muted">
          <Icon d="M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" size={14} className="mt-px shrink-0" />
          {COPY.hashNote}
        </p>
      </Panel>

      <section
        className="flex flex-col gap-3 rounded-lg bg-sage p-5 text-[13px] sm:p-[26px]"
        aria-labelledby="aud-auto"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="aud-auto" className="mr-auto text-xs font-semibold tracking-[0.08em] uppercase">
            {COPY.autoMessage}
          </h2>
          <Badge tone="light">5-bosqich</Badge>
        </div>
        <p className="text-xs">{COPY.autoPhase}</p>
        <div className="flex items-center gap-2 font-semibold">
          <Switch
            checked={d.autoMessage.enabled}
            onCheckedChange={(enabled) =>
              setD((x) => ({ ...x, autoMessage: { ...x.autoMessage, enabled } }))
            }
            aria-label={`${COPY.autoMessage}: yoqilgan`}
          />
          Yoqilgan
        </div>
        {d.autoMessage.steps.map((s, i) => {
          const set = (patch: Partial<typeof s>) =>
            setD((x) => ({
              ...x,
              autoMessage: {
                ...x.autoMessage,
                steps: x.autoMessage.steps.map((v, j) => (j === i ? { ...v, ...patch } : v)),
              },
            }));
          const tpl = list.templates.find((t) => t.key === s.templateKey);
          return (
            <div key={i} className="flex flex-col gap-2 rounded-md bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  aria-label="Kechikish (soat)"
                  className="h-9 w-20 rounded-pill bg-canvas px-3"
                  value={Math.round(s.delayMinutes / 60)}
                  onChange={(e) =>
                    set({ delayMinutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) * 60 })
                  }
                />
                <span>soatdan keyin</span>
                <select
                  aria-label="Kanal"
                  className="h-9 rounded-pill bg-canvas px-3"
                  value={s.channel}
                  onChange={(e) => set({ channel: e.target.value as 'telegram' | 'sms' })}
                >
                  <option value="telegram">Telegram</option>
                  <option value="sms">SMS</option>
                </select>
                <select
                  aria-label="Shablon"
                  className="h-9 rounded-pill bg-canvas px-3"
                  value={s.templateKey}
                  onChange={(e) => set({ templateKey: e.target.value })}
                >
                  {list.templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.key}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Qadamni o'chirish"
                  className="ml-auto size-8 rounded-pill hover:bg-canvas"
                  onClick={() =>
                    setD((x) => ({
                      ...x,
                      autoMessage: {
                        ...x.autoMessage,
                        steps: x.autoMessage.steps.filter((_, j) => j !== i),
                      },
                    }))
                  }
                >
                  ×
                </button>
              </div>
              {tpl ? <p className="text-muted">{tpl.preview}</p> : null}
            </div>
          );
        })}
        {d.autoMessage.steps.length < 3 && list.templates.length ? (
          <button
            type="button"
            className="self-start rounded-md border border-dashed border-ink/30 px-3 py-2 font-medium"
            onClick={() =>
              setD((x) => ({
                ...x,
                autoMessage: {
                  ...x.autoMessage,
                  steps: [
                    ...x.autoMessage.steps,
                    { channel: 'telegram', delayMinutes: 120, templateKey: list.templates[0]!.key },
                  ],
                },
              }))
            }
          >
            + Qadam
          </button>
        ) : null}
        <p className="text-xs">
          {COPY.result}:{' '}
          {result && result.members > 0
            ? `${fmt(result.members)} dan ${fmt(result.converted)} tasi xarid qildi (${result.crPct ?? 0}%) · ${formatCompactSoum(soumToTiyin(result.revenueSoum))}`
            : COPY.noResult}
        </p>
      </section>
    </form>
  );
}
