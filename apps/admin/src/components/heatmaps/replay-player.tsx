'use client';

import type { ReplayMarkerDto, ReplayOpenDto } from '@forest/contracts/core';
import { Button, cn } from '@forest/ui';
import { useEffect, useRef, useState } from 'react';
import type { Replayer as ReplayerType } from 'rrweb';
import 'rrweb/dist/style.css';
import { adminFetch, errorText } from '../../lib/client-api';
import { viaProxy } from '../../lib/snapshot';
import { COPY, formatDuration, MARKER, markerLabel } from './copy';

const SPEEDS = [1, 2, 4] as const;

/**
 * Session replay (A3): opening is a POST (audited `session.view_replay`), then rrweb's
 * `Replayer` renders the masked recording in its own sandboxed iframe. Timeline markers come from
 * our events (page, click, error, exit, rage, goals), aligned to server time.
 */
export function ReplayPlayer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<ReplayOpenDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const replayer = useRef<ReplayerType | null>(null);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [sessionId]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    adminFetch<ReplayOpenDto>(`/admin/replays/${encodeURIComponent(sessionId)}/open`, {
      method: 'POST',
    })
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!data || !host.current) return;
    let alive = true;
    let timer: number | undefined;
    const root = host.current;
    void import('rrweb').then(({ Replayer }) => {
      if (!alive) return;
      const r = new Replayer(viaProxy(data.events) as ConstructorParameters<typeof Replayer>[0], {
        root,
        skipInactive: true,
        showWarning: false,
        mouseTail: false,
        UNSAFE_replayCanvas: false,
        triggerFocus: false,
        speed: 1,
      });
      replayer.current = r;
      const fit = (dim: { width: number; height: number }) => {
        const w = stage.current?.clientWidth ?? dim.width;
        const s = Math.min(1, w / dim.width);
        r.wrapper.style.transform = `scale(${s})`;
        r.wrapper.style.transformOrigin = 'top left';
        root.style.height = `${Math.round(dim.height * s)}px`;
      };
      r.on('resize', (d) => fit(d as { width: number; height: number }));
      r.on('finish', () => setPlaying(false));
      const meta = r.getMetaData();
      setStart(meta.startTime);
      setTotal(meta.totalTime);
      r.play(0);
      setPlaying(true);
      timer = window.setInterval(() => setTime(r.getCurrentTime()), 250);
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      replayer.current?.pause();
      replayer.current?.destroy();
      replayer.current = null;
      root.innerHTML = '';
    };
  }, [data]);

  const toggle = () => {
    const r = replayer.current;
    if (!r) return;
    if (playing) r.pause();
    else r.play(time >= total ? 0 : time);
    setPlaying(!playing);
  };

  const seek = (offset: number) => {
    const r = replayer.current;
    if (!r) return;
    const t = Math.max(0, Math.min(total, offset));
    if (playing) r.play(t);
    else r.pause(t);
    setTime(t);
  };

  const changeSpeed = (s: (typeof SPEEDS)[number]) => {
    setSpeed(s);
    replayer.current?.setConfig({ speed: s });
  };

  const offsetOf = (m: ReplayMarkerDto) => m.ts - start;
  const chips = data?.markers.filter((m) => m.kind !== 'click') ?? [];

  return (
    <section
      ref={section}
      className="flex flex-col gap-3 rounded-md bg-off p-4 sm:p-5"
      aria-label={COPY.playerTitle}
      data-testid="replay-player"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-[15px] font-semibold">
          {COPY.playerTitle}
          {data ? ` · ${data.session.visitor.label} · ${formatDuration(total / 1000)}` : ''}
        </h3>
        <span className="text-xs text-muted">{COPY.playerMarkers}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {COPY.close}
        </Button>
      </div>
      <p className="text-xs text-muted">{COPY.playerMasked}</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">{COPY.playerLoading}</p> : null}
      {data?.truncated ? <p className="text-xs text-warn">{COPY.playerTruncated}</p> : null}

      <div ref={stage} className="w-full overflow-hidden rounded-sm border border-line bg-white">
        <div ref={host} className="replay-host relative" data-testid="replay-stage" />
      </div>

      {data ? (
        <>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={toggle} aria-pressed={playing}>
              {playing ? COPY.playPause.pause : COPY.playPause.play}
            </Button>
            <span className="tabular text-xs text-muted">
              {formatDuration(time / 1000)} / {formatDuration(total / 1000)}
            </span>
            <span className="ml-auto flex items-center gap-1 text-xs">
              {COPY.speed}
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeSpeed(s)}
                  aria-pressed={speed === s}
                  className={cn(
                    'rounded-pill px-2.5 py-1 font-semibold',
                    speed === s ? 'bg-ink text-white' : 'bg-panel',
                  )}
                >
                  {s}×
                </button>
              ))}
            </span>
          </div>
          <div
            className="relative h-6 cursor-pointer"
            role="slider"
            tabIndex={0}
            aria-label={COPY.playerTitle}
            aria-valuemin={0}
            aria-valuemax={Math.round(total / 1000)}
            aria-valuenow={Math.round(time / 1000)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - rect.left) / rect.width) * total);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seek(time + 5000);
              if (e.key === 'ArrowLeft') seek(time - 5000);
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-line" />
            <div
              className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-pill bg-ink"
              style={{ width: `${total ? (time / total) * 100 : 0}%` }}
            />
            {data.markers.map((m, i) => {
              const at = total ? offsetOf(m) / total : 0;
              if (at < 0 || at > 1) return null;
              return (
                <span
                  key={`${m.ts}-${i}`}
                  title={`${MARKER[m.kind].label}: ${markerLabel(m.kind, m.label)}`}
                  className={cn(
                    'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-white',
                    m.kind === 'click' ? 'size-2' : 'size-3.5',
                  )}
                  style={{ left: `${at * 100}%`, background: MARKER[m.kind].color }}
                />
              );
            })}
          </div>
          {chips.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Belgilar">
              {chips.slice(0, 40).map((m, i) => (
                <li key={`${m.ts}-${i}`}>
                  <button
                    type="button"
                    onClick={() => seek(offsetOf(m))}
                    className="inline-flex items-center gap-1.5 rounded-pill bg-panel px-3 py-1.5 text-xs"
                  >
                    <span
                      aria-hidden
                      className="size-2 rounded-pill"
                      style={{ background: MARKER[m.kind].color }}
                    />
                    {markerLabel(m.kind, m.label)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
