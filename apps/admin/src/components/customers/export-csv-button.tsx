'use client';

import { Button } from '@forest/ui';
import { useState } from 'react';
import { adminDownload, errorText } from '../../lib/client-api';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Owner-only CSV of the current filter (docs/02 "Export customer database"). Phones are masked
 * unless the owner explicitly asks for full numbers — that choice is written to the audit log.
 */
export function ExportCsvButton({
  filters,
  total,
}: {
  filters: Record<string, string>;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { reveal };
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === 'sort') continue;
      body[k] = k === 'ltvMin' || k === 'ltvMax' ? Number(v) : v;
    }
    try {
      await adminDownload('/admin/customers/export', body, 'mijozlar.csv');
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={total === 0}>
        Export CSV
      </Button>
      <ConfirmDialog
        open={open}
        title="Mijozlarni eksport qilish"
        confirmLabel="Yuklab olish"
        busy={busy}
        error={error}
        onConfirm={() => void run()}
        onClose={() => setOpen(false)}
      >
        <p>
          Joriy filtr bo&apos;yicha {total} ta mijoz CSV faylga yoziladi. Eksport faoliyat jurnaliga
          yoziladi.
        </p>
        <label className="flex items-start gap-2 font-semibold">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="mt-0.5 size-4 accent-forest"
          />
          <span>
            To&apos;liq telefon raqamlari bilan
            <span className="block font-normal text-muted">
              Faqat zarur bo&apos;lsa. Faylni xavfsiz saqlang — unda shaxsiy ma&apos;lumot bor.
            </span>
          </span>
        </label>
      </ConfirmDialog>
    </>
  );
}
