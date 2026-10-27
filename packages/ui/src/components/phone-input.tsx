'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';
import { inputClasses } from './field';

/** Formats up to 9 local digits as `90 123 45 67`. */
export function formatLocalDigits(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
}

/** Extracts the 9 local digits from anything the user typed or pasted (incl. +998 prefix). */
export function toLocalDigits(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('998') && d.length > 9) d = d.slice(3);
  return d.slice(0, 9);
}

export interface PhoneInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  /** 9 local digits (without +998). */
  value: string;
  onValueChange: (digits: string) => void;
  /** Extra classes for the `<input>` (wrapper gets `className`), e.g. pill variants. */
  inputClassName?: string;
  /** Extra classes for the `+998` prefix. */
  prefixClassName?: string;
}

/** `+998` prefix + masked local part. Emits raw digits; E.164 is built server-side by zod. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onValueChange, className, inputClassName, prefixClassName, ...rest },
  ref,
) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-4 text-[15px] font-medium text-muted',
          prefixClassName,
        )}
      >
        +998
      </span>
      <input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="90 123 45 67"
        data-private
        className={cn(inputClasses, 'pl-[68px] tabular', inputClassName)}
        value={formatLocalDigits(value)}
        onChange={(e) => onValueChange(toLocalDigits(e.target.value))}
        {...rest}
      />
    </div>
  );
});
