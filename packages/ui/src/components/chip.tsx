import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { cn } from '../cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Surface the chip sits on: chips on white panels use canvas fill, on canvas use white. */
  surface?: 'panel' | 'canvas';
}

/** Toggleable pill used for filters, tabs and category chips. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, surface = 'panel', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-medium transition-colors',
        selected
          ? 'bg-ink text-white'
          : surface === 'panel'
            ? 'bg-canvas text-ink hover:bg-sage'
            : 'bg-panel text-ink hover:bg-sage-50',
        className,
      )}
      {...rest}
    />
  );
});

const tones = {
  neutral: 'bg-canvas text-ink',
  dark: 'bg-ink text-white',
  light: 'bg-white text-ink',
  sage: 'bg-sage text-forest',
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  critical: 'bg-critical-bg text-critical',
  info: 'bg-[#E6EEF8] text-[#1F4E86]',
  lead: 'bg-[#EFE8F7] text-[#5B3B87]',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-pill px-2.5 text-xs font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
