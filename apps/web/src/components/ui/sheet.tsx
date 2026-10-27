'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@forest/ui';
import type { ReactNode } from 'react';

/**
 * Mobile bottom sheet on Radix Dialog (focus trap, Esc, scroll lock, aria-modal).
 * Lives in the web app because @radix-ui/react-dialog is a web dependency.
 */
export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  headerAction,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/45" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-lg bg-panel focus:outline-none',
            className,
          )}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-[5px] w-10 shrink-0 rounded-pill bg-line" />
          <div className="flex items-center justify-between px-5 pt-4">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            {headerAction}
          </div>
          {description ? (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="border-t border-line px-5 pt-3 pb-5">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetClose = Dialog.Close;
