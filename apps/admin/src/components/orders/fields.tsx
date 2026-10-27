'use client';

import { Input, Textarea } from '@forest/ui';
import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

/** Label + design-system input wired by id (jsx-a11y can't see through the Input component). */
export function TextField({
  label,
  ...props
}: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <Input id={id} {...props} />
    </div>
  );
}

export function TextAreaField({
  label,
  ...props
}: { label: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <Textarea id={id} {...props} />
    </div>
  );
}
