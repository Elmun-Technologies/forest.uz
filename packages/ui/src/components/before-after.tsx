'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '../cn';

export interface BeforeAfterProps {
  /** Full-bleed "after" layer (usually a next/image with `fill`). */
  after: ReactNode;
  /** "Before" layer, clipped to the left part. */
  before: ReactNode;
  /** Accessible name of the range input. */
  label: string;
  /** Initial divider position in % (4–96). */
  initial?: number;
  /** `responsive` = 52 px on mobile, 64 px from `lg` (design). */
  handleSize?: 'md' | 'lg' | 'responsive';
  className?: string;
  /** Overlays (badges, cards) rendered above the slider; keep them pointer-events-none or small. */
  children?: ReactNode;
}

/**
 * Before/after comparison. A native range input covers the whole frame, so dragging,
 * touch and keyboard (arrows / Home / End) all work without custom gesture code.
 */
export function BeforeAfter({
  after,
  before,
  label,
  initial = 50,
  handleSize = 'lg',
  className,
  children,
}: BeforeAfterProps) {
  const [pos, setPos] = useState(initial);
  const id = useId();
  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {before}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -ml-[1.5px] w-[3px] bg-white"
        style={{ left: `${pos}%` }}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill bg-white shadow-[0_6px_20px_rgb(20_23_18/0.3)]',
          handleSize === 'lg' && 'size-16',
          handleSize === 'md' && 'size-[52px]',
          handleSize === 'responsive' && 'size-[52px] lg:size-16',
        )}
        style={{ left: `${pos}%` }}
      >
        <svg
          viewBox="0 0 24 24"
          className={cn(
            handleSize === 'lg' && 'size-[26px]',
            handleSize === 'md' && 'size-5',
            handleSize === 'responsive' && 'size-5 lg:size-[26px]',
          )}
          fill="none"
          stroke="#141712"
          strokeWidth="2"
        >
          <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
        </svg>
      </span>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={4}
        max={96}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="ba-range absolute inset-0 m-0 size-full cursor-ew-resize appearance-none bg-transparent opacity-100 focus-visible:outline-3 focus-visible:-outline-offset-[6px] focus-visible:outline-white"
      />
      {children}
    </div>
  );
}
