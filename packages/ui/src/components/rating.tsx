import { cn } from '../cn';

const STAR = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';

export interface RatingProps {
  /** 0–5, may be fractional (rendered as partially filled last star). */
  value: number;
  /** Accessible label, e.g. "5 dan 4,8" — required because stars alone convey nothing. */
  label: string;
  size?: number;
  className?: string;
}

/**
 * Read-only star rating. Only render it with real, verified data — never with placeholder
 * numbers (CLAUDE.md pitfalls).
 */
export function Rating({ value, label, size = 14, className }: RatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <span role="img" aria-label={label} className={cn('relative inline-flex', className)}>
      <span className="inline-flex gap-px text-line" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d={STAR} />
          </svg>
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 inline-flex gap-px overflow-hidden text-forest"
        style={{ width: `${(clamped / 5) * 100}%` }}
        aria-hidden
      >
        {Array.from({ length: 5 }, (_, i) => (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            className="shrink-0"
          >
            <path d={STAR} />
          </svg>
        ))}
      </span>
    </span>
  );
}
