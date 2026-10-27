'use client';

import { cn } from '../cn';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible names of the buttons / value, localized by the caller. */
  labels: { decrease: string; increase: string; value: string };
  size?: 'md' | 'lg';
  className?: string;
}

/** Quantity stepper (− n +). The value is announced via an `output` with aria-live. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  labels,
  size = 'lg',
  className,
}: StepperProps) {
  const btn = cn(
    'grid place-items-center text-xl text-ink transition-colors hover:bg-canvas disabled:opacity-40',
    size === 'lg' ? 'h-[52px] w-12' : 'h-12 w-9',
  );
  return (
    <span
      className={cn('inline-flex items-center rounded-pill border border-line bg-panel', className)}
    >
      <button
        type="button"
        className={cn(btn, 'rounded-l-pill')}
        aria-label={labels.decrease}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <output
        aria-label={labels.value}
        aria-live="polite"
        className={cn('tabular text-center font-semibold', size === 'lg' ? 'min-w-7' : 'min-w-4')}
      >
        {value}
      </output>
      <button
        type="button"
        className={cn(btn, 'rounded-r-pill')}
        aria-label={labels.increase}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}
