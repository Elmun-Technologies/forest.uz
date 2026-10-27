'use client';

import { Button } from '@forest/ui';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { FormError } from '../auth-card';

/**
 * Native `<dialog>` confirmation (focus trap + Esc for free). With `typed`, the action unlocks only
 * after the user types that exact value (destructive actions: erase, disconnect).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  typed,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  typed?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setValue('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const ready = !typed || value.trim().toUpperCase() === typed.toUpperCase();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready && !busy) onConfirm();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-lg bg-panel p-0 text-ink shadow-float backdrop:bg-ink/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-6 text-[13px]">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="flex flex-col gap-2 leading-relaxed text-ink-2">{children}</div>
        {typed ? (
          <label className="flex flex-col gap-1.5 font-semibold">
            Tasdiqlash uchun <code className="font-mono">{typed}</code> ni kiriting
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              className="h-11 rounded-sm border border-line px-3 font-mono text-sm focus:border-ink focus:outline-none"
            />
          </label>
        ) : null}
        <FormError message={error ?? null} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={!ready}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
