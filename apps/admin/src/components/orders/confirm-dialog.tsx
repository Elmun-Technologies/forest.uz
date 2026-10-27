'use client';

import { Button } from '@forest/ui';
import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * Modal confirmation for destructive / paid actions (docs/08 "All destructive actions confirm").
 * Native <dialog>: focus trap, Esc to close and the backdrop come from the browser.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  error?: string | null;
  onConfirm: (form: FormData) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onConfirm(new FormData(e.currentTarget));
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-md bg-panel p-0 text-ink backdrop:bg-ink/50"
    >
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-4 p-6 text-sm">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {children}
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Yopish
            </Button>
            <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
