'use client';

import { type AdminCwvDto, type CwvMetric, cwvRating } from '@forest/contracts/core';
import { Button, cn, Panel } from '@forest/ui';
import { useState } from 'react';
import { adminFetch } from '../../lib/client-api';
import { COPY } from './copy';
import { useAction } from './site-panels';

const fmt = (m: CwvMetric, v: number | null) =>
  v === null
    ? '—'
    : m === 'CLS'
      ? String(v).replace('.', ',')
      : m === 'LCP'
        ? `${(v / 1000).toFixed(1).replace('.', ',')} s`
        : `${v} ms`;

const tone = (m: CwvMetric, v: number | null) => {
  if (v === null) return 'bg-off text-muted';
  const r = cwvRating(m, v);
  return r === 'good'
    ? 'bg-good-bg text-good'
    : r === 'poor'
      ? 'bg-critical-bg text-critical'
      : 'bg-warn-bg text-warn';
};

/** Field CWV (p75 from web_vitals) + optional PageSpeed lab runs. */
export function CwvPanel({ cwv, canRunLab }: { cwv: AdminCwvDto; canRunLab: boolean }) {
  const { busy, run, message } = useAction();
  const [path, setPath] = useState('/uz');
  const hasData = cwv.metrics.some((m) => m.samples > 0);
  return (
    <Panel as="section" className="flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="seo-cwv">
      <h2 id="seo-cwv" className="text-xl font-semibold">
        {cwv.scope === 'mobile' ? COPY.cwv : COPY.cwvAll}
      </h2>
      {hasData ? (
        <div className="grid grid-cols-3 gap-2">
          {cwv.metrics.map((m) => (
            <div
              key={m.metric}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md p-3',
                tone(m.metric, m.p75),
              )}
            >
              <span className="text-xs font-semibold">
                {m.metric} {m.rating === 'good' ? '✓' : m.rating ? '!' : ''}
              </span>
              <b className="tabular text-xl font-semibold">{fmt(m.metric, m.p75)}</b>
              <span className="text-[11px] opacity-80">{m.samples} o&apos;lchov</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md bg-off p-4 text-[13px] text-muted">{COPY.cwvEmpty}</p>
      )}
      {cwv.pages.length > 0 ? (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-normal">Sahifa (p75)</th>
              <th className="py-1 text-right font-normal">LCP</th>
              <th className="py-1 text-right font-normal">INP</th>
              <th className="py-1 text-right font-normal">CLS</th>
            </tr>
          </thead>
          <tbody>
            {cwv.pages.slice(0, 8).map((p) => (
              <tr key={p.path} className="border-t border-line-soft">
                <td className="max-w-40 truncate py-1.5 font-mono">{p.path}</td>
                {(['LCP', 'INP', 'CLS'] as const).map((m) => (
                  <td key={m} className="py-1.5 text-right">
                    <span className={cn('rounded-pill px-1.5', tone(m, p[m]))}>{fmt(m, p[m])}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
        <span className="text-xs font-semibold">PageSpeed Insights (laboratoriya, mobil)</span>
        {canRunLab ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'psi',
                () =>
                  adminFetch('/admin/seo/cwv/pagespeed', {
                    method: 'POST',
                    body: { path, strategy: 'mobile' },
                  }),
                "O'lchov tugadi.",
              );
            }}
          >
            <input
              className="h-9 flex-1 rounded-sm border border-line px-2 font-mono text-xs"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              aria-label="Sahifa yo'li"
            />
            <Button type="submit" size="sm" loading={busy === 'psi'}>
              O&apos;lchash
            </Button>
          </form>
        ) : (
          <span className="text-[11px] text-muted">
            Ixtiyoriy: Integratsiyalar → PageSpeed Insights ulansa, shu yerdan o&apos;lchash mumkin.
          </span>
        )}
        {cwv.lab.map((r) => (
          <span key={r.id} className="text-[11px] text-muted">
            {r.url.replace(/^https?:\/\/[^/]+/, '')} · ball {r.score ?? '—'} · LCP{' '}
            {fmt('LCP', r.lcpMs)} · CLS {fmt('CLS', r.cls)} · TBT {r.tbtMs ?? '—'} ms
          </span>
        ))}
        {message}
      </div>
    </Panel>
  );
}
