'use client';

import type { AdSpendImportResultDto } from '@forest/contracts/core';
import { Button } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { adminFetch, ClientApiError, errorText } from '../../lib/client-api';
import { INT } from './copy';

const MAX_BYTES = 2_000_000;
const TEMPLATE =
  'date,platform,campaign_id,campaign,adset,spend,impressions,clicks\n2026-10-01,meta,120210000,divan_oldin_keyin_reels,reels,182000,10450,312\n';

/**
 * Ad spend CSV upload (A2 Sources): the file's text is posted as is; the API validates every
 * line and saves all or nothing (idempotent per day + platform + campaign).
 */
export function AdSpendImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdSpendImportResultDto | null>(null);
  const [error, setError] = useState<{
    message: string;
    lines: { line: number; message: string }[];
  } | null>(null);

  async function upload(file: File) {
    setResult(null);
    setError(null);
    if (file.size > MAX_BYTES) {
      setError({ message: "Fayl 2 MB dan katta. Davrni bo'lib yuklang.", lines: [] });
      return;
    }
    setBusy(true);
    try {
      const csv = await file.text();
      const r = await adminFetch<AdSpendImportResultDto>('/admin/analytics/ad-spend/import', {
        method: 'POST',
        body: { csv },
      });
      setResult(r);
      router.refresh();
    } catch (e) {
      const lines =
        e instanceof ClientApiError && Array.isArray(e.details?.errors)
          ? (e.details.errors as { line: number; message: string }[])
          : [];
      setError({ message: errorText(e), lines });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="ad-spend-import">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="ad-spend-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}>
          CSV yuklash
        </Button>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="reklama-xarajati-namuna.csv"
          className="text-xs underline"
        >
          Fayl shabloni
        </a>
      </div>
      <p className="text-xs text-muted">
        Ustunlar: date, platform (meta/google/tiktok/yandex), campaign_id, campaign, adset, spend
        (so&apos;m), impressions, clicks. Qayta yuklash o&apos;sha kun va kampaniyani yangilaydi.
      </p>
      {result ? (
        <p role="status" className="text-xs font-semibold text-good">
          {INT(result.rows)} qator saqlandi ({INT(result.inserted)} yangi, {INT(result.updated)}{' '}
          yangilandi){result.firstDay ? ` · ${result.firstDay} — ${result.lastDay}` : ''}.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-sm bg-critical-bg p-3 text-xs text-critical">
          <p className="font-semibold">{error.message}</p>
          {error.lines.length ? (
            <ul className="mt-1 list-disc pl-4">
              {error.lines.slice(0, 10).map((l) => (
                <li key={l.line}>
                  {l.line}-qator: {l.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
