import type { ChannelRowDto, FunnelStepDto } from '@forest/contracts/core';
import { cn } from '@forest/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { channelLabel, FUNNEL_DROP, FUNNEL_LABEL, INT, PCT, SOUM_SHORT } from './copy';

/** Horizontal meter: a value against the largest one of its list. */
export function Meter({
  value,
  max,
  tone = 'forest',
  label,
}: {
  value: number;
  max: number;
  tone?: 'forest' | 'exit';
  label?: string;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="block h-1.5 w-full overflow-hidden rounded-pill bg-canvas"
    >
      <span
        className={cn('block h-full rounded-pill', tone === 'exit' ? 'bg-chart-3' : 'bg-chart-1')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/** Sales funnel with drop-off per step (A1 "Savdo voronkasi", A2 Funnel). */
export function FunnelBars({ steps, testId }: { steps: FunnelStepDto[]; testId?: string }) {
  const top = steps[0]?.sessions ?? 0;
  if (!top) return <Empty>Bu davrda sessiyalar yo&apos;q.</Empty>;
  return (
    <ol className="flex flex-col gap-3" data-testid={testId}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.sessions : null;
        const drop = prev ? 1 - s.sessions / prev : null;
        return (
          <li key={s.step} className="flex flex-col gap-1.5" data-step={s.step}>
            <span className="flex items-baseline justify-between gap-3">
              <b className="font-semibold">{FUNNEL_LABEL[s.step]}</b>
              <span className="tabular">
                <b
                  className="font-semibold"
                  data-testid={testId ? `${testId}-${s.step}` : undefined}
                >
                  {INT(s.sessions)}
                </b>{' '}
                <span className="text-muted">· {PCT(s.sessions / top)}</span>
              </span>
            </span>
            <span className="block h-7 w-full overflow-hidden rounded-xs bg-canvas">
              <span
                className="block h-full rounded-xs bg-forest"
                style={{ width: `${Math.max(s.sessions ? 1 : 0, (s.sessions / top) * 100)}%` }}
              />
            </span>
            {drop !== null && drop > 0 && FUNNEL_DROP[s.step] ? (
              <span className="text-xs text-critical">
                ↓ {PCT(drop, 0)} shu yerda ketdi: {FUNNEL_DROP[s.step]}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Traffic sources by channel (A1 "Trafik manbalari"). */
export function ChannelList({ rows }: { rows: ChannelRowDto[] }) {
  const max = Math.max(0, ...rows.map((r) => r.sessions));
  if (!rows.length) return <Empty>Bu davrda trafik yo&apos;q.</Empty>;
  return (
    <ul className="flex flex-col" data-testid="channel-list">
      {rows.map((r) => (
        <li
          key={r.channel}
          className="grid grid-cols-[minmax(0,1fr)_64px_56px_84px] items-center gap-x-3 border-t border-line-soft py-2.5 first:border-t-0"
        >
          <span className="flex min-w-0 flex-col gap-1.5">
            <b className="truncate font-semibold">{channelLabel(r.channel)}</b>
            <Meter value={r.sessions} max={max} label={`${channelLabel(r.channel)} sessiyalari`} />
          </span>
          <span className="tabular text-right">{INT(r.sessions)}</span>
          <span className="tabular text-right text-muted">
            {r.sessions ? PCT(r.purchasingSessions / r.sessions) : '—'}
          </span>
          <b className="tabular text-right font-semibold">{SOUM_SHORT(r.revenueSoum)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-canvas px-4 py-6 text-center text-muted">{children}</p>;
}

/** Segmented links (period switch, tabs) that keep the other query params. */
export function SegmentLinks({
  items,
  label,
  tone = 'panel',
}: {
  items: { href: string; label: string; active: boolean }[];
  label: string;
  tone?: 'panel' | 'canvas';
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'flex flex-wrap gap-1 rounded-pill p-1',
        tone === 'panel' ? 'bg-panel' : 'bg-canvas',
      )}
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          prefetch={false}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'rounded-pill px-4 py-[9px] text-[13px] font-semibold transition-colors',
            t.active ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
