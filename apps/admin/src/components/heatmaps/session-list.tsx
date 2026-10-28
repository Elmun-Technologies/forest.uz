'use client';

import type { ReplayListDto, ReplaySessionDto } from '@forest/contracts/core';
import { Badge, Button } from '@forest/ui';
import { useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { channelLabel, DEVICE_LABEL } from '../analytics/copy';
import { COPY, formatDuration, OUTCOME, pathLabel } from './copy';
import { ReplayPlayer } from './replay-player';

/** A3 "Sessiya yozuvlari": rows with a play button; the player opens under the table. */
export function SessionList({
  initial,
  query,
  openId = null,
}: {
  initial: ReplayListDto;
  query: string;
  /** `?session=<id>` (A5/A7 "view purchase session" links): open this replay at once. */
  openId?: string | null;
}) {
  const [items, setItems] = useState<ReplaySessionDto[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(openId);

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams(query);
      q.set('cursor', cursor);
      const page = await adminFetch<ReplayListDto>(`/admin/replays?${q.toString()}`);
      setItems((cur) => [...cur, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const player = open ? (
    <ReplayPlayer key={open} sessionId={open} onClose={() => setOpen(null)} />
  ) : null;
  if (items.length === 0)
    return (
      <div className="flex flex-col gap-3">
        <p className="py-6 text-sm text-muted">{COPY.sessionsEmpty}</p>
        {player}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-xs text-muted">
              <th className="w-12 py-2" aria-label={COPY.play} />
              <th className="py-2 font-medium">{COPY.colVisitor}</th>
              <th className="py-2 font-medium">{COPY.colSource}</th>
              <th className="py-2 font-medium">{COPY.colDevice}</th>
              <th className="py-2 font-medium">{COPY.colTime}</th>
              <th className="py-2 font-medium">{COPY.colPath}</th>
              <th className="py-2 font-medium">{COPY.colResult}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr
                key={s.id}
                className={open === s.id ? 'bg-sage-50' : 'border-t border-line-soft'}
                data-testid="replay-row"
                data-session={s.id}
              >
                <td className="py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpen(s.id)}
                    aria-label={`${COPY.play}: ${s.visitor.label}`}
                    className="grid size-10 place-items-center rounded-pill bg-ink text-white focus-visible:outline-3 focus-visible:outline-forest"
                    data-testid="replay-play"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                      <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
                    </svg>
                  </button>
                </td>
                <td className="py-2.5">
                  <span className="flex flex-col">
                    <b className="font-semibold">{s.visitor.label}</b>
                    <span className="text-xs text-muted">
                      {[s.region, formatWhen(s.startedAt)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </td>
                <td className="py-2.5">{channelLabel(s.channel)}</td>
                <td className="py-2.5">{DEVICE_LABEL[s.device] ?? s.device}</td>
                <td className="tabular py-2.5">{formatDuration(s.durationSec)}</td>
                <td
                  className="max-w-[360px] truncate py-2.5 text-ink-2"
                  title={s.pages.join(' → ')}
                >
                  {s.pages.map(pathLabel).join(' → ')}
                  {s.pageCount > s.pages.length ? ' → …' : ''}
                </td>
                <td className="py-2.5">
                  <Badge tone={OUTCOME[s.outcome].tone}>
                    {OUTCOME[s.outcome].label}
                    {s.outcome === 'rage' && s.rageClicks > 1 ? ` ×${s.rageClicks}` : ''}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor ? (
        <Button size="sm" variant="outline" onClick={more} disabled={busy} className="self-start">
          {COPY.more}
        </Button>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {player}
    </div>
  );
}
