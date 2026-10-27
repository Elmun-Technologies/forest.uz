'use client';

import type { LocalizedText } from '@forest/contracts/core';
import { cn, Field, Input, Textarea } from '@forest/ui';

export const compactInput = 'h-10 text-sm';
export const selectClass =
  'h-10 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none disabled:bg-off disabled:text-muted';

/** UZ + RU pair of one localized field (stacked on narrow panels). */
export function LocalizedInput({
  label,
  value,
  onChange,
  disabled,
  multiline,
  rows = 4,
  maxLength,
  required,
  testId,
}: {
  label: string;
  value: LocalizedText;
  onChange: (v: LocalizedText) => void;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  testId?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['uz', 'ru'] as const).map((l) => (
        <Field key={l} label={`${label} · ${l.toUpperCase()}`}>
          {(p) =>
            multiline ? (
              <Textarea
                {...p}
                rows={rows}
                value={value[l]}
                disabled={disabled}
                maxLength={maxLength}
                className="min-h-20 text-sm"
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              />
            ) : (
              <Input
                {...p}
                value={value[l]}
                disabled={disabled}
                maxLength={maxLength}
                required={required}
                className={compactInput}
                data-testid={testId ? `${testId}-${l}` : undefined}
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              />
            )
          }
        </Field>
      ))}
    </div>
  );
}

/** Toggle chips for a multi-choice list (badges, surfaces, categories). */
export function ChipToggles<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-[13px] font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() =>
                onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])
              }
              className={cn(
                'h-8 rounded-pill px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed',
                on ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage',
              )}
            >
              {on ? '✓ ' : ''}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Integer input that keeps '' while typing; `null` = empty. */
export function NumberInput({
  value,
  onChange,
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  disabled?: boolean;
  min?: number;
  step?: number | 'any';
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-testid'?: string;
  className?: string;
}) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      {...rest}
      className={cn(compactInput, 'tabular', rest.className)}
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}
