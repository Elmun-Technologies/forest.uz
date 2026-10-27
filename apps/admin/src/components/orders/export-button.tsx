'use client';

import { Button } from '@forest/ui';
import { useState } from 'react';
import { adminDownload, errorText } from '../../lib/client-api';

/** POST /admin/orders/export with the current filters → CSV download (audited server-side). */
export function ExportButton({ filter }: { filter: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await adminDownload(
        '/admin/orders/export',
        filter,
        `buyurtmalar-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="inverse" onClick={run} loading={busy}>
        Eksport (CSV)
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
