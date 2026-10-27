'use client';

import type { AdminProductDto } from '@forest/contracts/core';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { errorText } from '../../lib/client-api';

/**
 * Every product mutation returns the fresh `AdminProductDto`: the editor swaps it in and refreshes
 * the server-rendered list/KPIs around it.
 */
export function useProductAction(setProduct: (p: AdminProductDto) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, action: () => Promise<AdminProductDto | void>, done?: string) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const next = await action();
        if (next) setProduct(next);
        if (done) setNotice(done);
        router.refresh();
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [router, setProduct],
  );

  return { busy, error, notice, run, setError };
}

export type ProductAction = ReturnType<typeof useProductAction>;
