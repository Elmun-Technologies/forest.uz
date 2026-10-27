'use client';

import type { ReplaySettingsDto } from '@forest/contracts/core';
import { Button, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { COPY, pathLabel } from './copy';

/** Page picker: top paths of the period (+ the current one if it has no data yet). */
export function PagePicker({
  pages,
  current,
  hrefFor,
}: {
  pages: { path: string; sessions: number }[];
  current: string;
  hrefFor: Record<string, string>;
}) {
  const router = useRouter();
  const id = useId();
  const options = pages.some((p) => p.path === current)
    ? pages
    : [{ path: current, sessions: 0 }, ...pages];
  return (
    <label
      htmlFor={id}
      className="flex h-11 items-center gap-2 rounded-pill bg-panel pr-2 pl-4 text-[13px]"
    >
      <span className="text-muted">{COPY.page}:</span>
      <select
        id={id}
        value={current}
        onChange={(e) => {
          const href = hrefFor[e.target.value];
          if (href) router.push(href);
        }}
        className="max-w-[260px] bg-transparent font-semibold focus:outline-none"
        data-testid="heatmap-page"
      >
        {options.map((p) => (
          <option key={p.path} value={p.path}>
            {pathLabel(p.path)}
            {p.sessions ? ` · ${p.sessions}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Queues `heatmaps.aggregate` for the last 2 days (audited). */
export function RefreshButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            await adminFetch('/admin/heatmaps/refresh', { method: 'POST', body: { days: 2 } });
            setState('done');
          } catch (e) {
            setState(errorText(e));
          }
        }}
      >
        {COPY.refresh}
      </Button>
      {state === 'done' ? (
        <span className="text-xs text-good">{COPY.refreshQueued}</span>
      ) : state !== 'idle' && state !== 'busy' ? (
        <span className="text-xs text-danger">{state}</span>
      ) : null}
    </span>
  );
}

const input =
  'h-10 w-24 rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none disabled:bg-off';

/** Replay kill switch and sample rates (`settings.store`, Owner; others read-only). */
export function ReplaySettingsForm({
  initial,
  canEdit,
}: {
  initial: ReplaySettingsDto;
  canEdit: boolean;
}) {
  const [doc, setDoc] = useState(initial);
  const [v, setV] = useState(initial.value);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { on: useId(), sample: useId(), checkout: useId() };
  const pct = (s: string) => Math.max(0, Math.min(100, Math.round(Number(s) || 0)));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await adminFetch<ReplaySettingsDto>('/admin/heatmaps/settings', {
        method: 'PUT',
        body: { value: v, version: doc.version },
      });
      setDoc(next);
      setV(next.value);
      setMsg({ ok: true, text: COPY.saved });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="replay-settings">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={ids.on} className="font-semibold">
          {COPY.settingsEnabled}
        </label>
        <Switch
          id={ids.on}
          checked={v.replayEnabled}
          disabled={!canEdit}
          onCheckedChange={(c) => setV({ ...v, replayEnabled: c })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={ids.sample}>{COPY.settingsSample}</label>
        <input
          id={ids.sample}
          type="number"
          min={0}
          max={100}
          className={input}
          value={v.replaySamplePct}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, replaySamplePct: pct(e.target.value) })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={ids.checkout}>{COPY.settingsCheckout}</label>
        <input
          id={ids.checkout}
          type="number"
          min={0}
          max={100}
          className={input}
          value={v.replayCheckoutPct}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, replayCheckoutPct: pct(e.target.value) })}
        />
      </div>
      <p className="text-xs text-muted">{COPY.settingsHint}</p>
      {canEdit ? (
        <span className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy}>
            {COPY.save}
          </Button>
          {msg ? (
            <span className={msg.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{msg.text}</span>
          ) : null}
        </span>
      ) : (
        <p className="text-xs text-muted">{COPY.settingsReadOnly}</p>
      )}
    </div>
  );
}
