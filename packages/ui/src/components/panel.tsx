import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

const tones = {
  panel: 'bg-panel text-ink',
  dark: 'bg-ink text-white',
  forest: 'bg-forest text-white',
  sage: 'bg-sage text-ink',
  warn: 'bg-warn-bg text-warn',
  critical: 'bg-critical-bg text-critical',
} as const;

const radii = { md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' } as const;

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  tone?: keyof typeof tones;
  radius?: keyof typeof radii;
  as?: 'div' | 'section' | 'article' | 'aside';
}

/** White rounded panel on the canvas — the basic layout unit of both storefront and admin. */
export function Panel({
  tone = 'panel',
  radius = 'lg',
  as: Tag = 'div',
  className,
  ...rest
}: PanelProps) {
  return <Tag className={cn(tones[tone], radii[radius], className)} {...rest} />;
}

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'panel' | 'dark' | 'warn' | 'critical' | 'sage';
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean } | null;
  className?: string;
}

export function KpiTile({ label, value, hint, tone = 'panel', delta, className }: KpiTileProps) {
  return (
    <Panel
      tone={tone}
      radius="md"
      className={cn('flex min-w-[180px] flex-1 flex-col gap-2 p-5', className)}
    >
      <span className={cn('text-[13px]', tone === 'dark' ? 'text-on-dark-muted' : 'opacity-80')}>
        {label}
      </span>
      <span className="tabular text-[30px] leading-none font-medium tracking-[-0.03em]">
        {value}
      </span>
      {delta ? (
        <span
          className={cn(
            'text-xs font-semibold',
            (delta.good ?? delta.direction === 'up')
              ? 'text-good'
              : delta.direction === 'flat'
                ? 'text-muted'
                : 'text-critical',
          )}
        >
          {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '•'} {delta.value}
        </span>
      ) : hint ? (
        <span className="text-xs opacity-70">{hint}</span>
      ) : null}
    </Panel>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-sm bg-line-soft', className)} />;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
