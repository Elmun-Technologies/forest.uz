'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../cn';

/** 44×26 switch, knob 20 (docs/11). Must be given an accessible name via aria-label or <label>. */
export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...rest }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-pill transition-colors',
        'bg-line data-[state=checked]:bg-forest disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-[3px] rounded-pill bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  );
});
