'use client';

import type { AdminNotFoundDto, AdminRedirectDto } from '@forest/contracts/core';
import { Badge, Button, Panel } from '@forest/ui';
import { type FormEvent, useState } from 'react';
import { adminFetch } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { COPY } from './copy';
import { useAction } from './site-panels';

const input =
  'h-10 w-full rounded-sm border border-line bg-panel px-3 font-mono text-xs focus:border-ink focus:outline-none';

/** 301 manager (A9) + 404 log with "create redirect" from the closest live path. */
export function RedirectsPanel({
  redirects,
  total,
  notFound,
}: {
  redirects: AdminRedirectDto[];
  total: number;
  notFound: AdminNotFoundDto[];
}) {
  const { busy, run, message } = useAction();
  const [form, setForm] = useState({ id: null as string | null, from: '', to: '', code: 301 });

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { from: form.from, to: form.to, code: form.code };
    void run(
      'save',
      () =>
        form.id
          ? adminFetch(`/admin/seo/redirects/${form.id}`, { method: 'PATCH', body })
          : adminFetch('/admin/seo/redirects', { method: 'POST', body }),
      'Redirect saqlandi.',
    ).then((ok) => {
      if (ok) setForm({ id: null, from: '', to: '', code: 301 });
    });
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Panel
        as="section"
        className="flex flex-col gap-3 p-5 sm:p-6"
        aria-labelledby="redirects-title"
        id="redirects"
      >
        <h2 id="redirects-title" className="text-xl font-semibold">
          {COPY.redirects} <span className="text-[13px] font-normal text-muted">· {total} ta</span>
        </h2>
        <form
          onSubmit={submit}
          className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_auto]"
          aria-label="Redirect"
        >
          <input
            className={input}
            placeholder="/uz/p/eski-manzil"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            aria-label="Qayerdan"
            required
            data-testid="redirect-from"
          />
          <input
            className={input}
            placeholder="/uz/p/yangi-manzil"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            aria-label="Qayerga"
            required
            data-testid="redirect-to"
          />
          <select
            className={input}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: Number(e.target.value) })}
            aria-label="Kod"
          >
            {[301, 302, 307, 308].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <Button
            type="submit"
            size="sm"
            className="h-10"
            loading={busy === 'save'}
            data-testid="redirect-save"
          >
            {form.id ? 'Saqlash' : "Qo'shish"}
          </Button>
        </form>
        <p className="text-[11px] text-muted">
          Zanjir bo&apos;lmaydi: manzil yakuniy sahifaga ulanadi; aylanma va ishlayotgan sahifadan
          redirect rad etiladi.
        </p>
        {message}
        {redirects.length === 0 ? (
          <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">
            Redirect yo&apos;q.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-2 font-normal">Qayerdan → qayerga</th>
                  <th className="py-2 text-right font-normal">Kod</th>
                  <th className="py-2 text-right font-normal">Hits</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {redirects.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft" data-testid="redirect-row">
                    <td className="py-2 font-mono text-xs">
                      {r.from}
                      <span className="text-muted"> → </span>
                      {r.to}
                    </td>
                    <td className="py-2 text-right">{r.code}</td>
                    <td className="tabular py-2 text-right">
                      {r.hits}
                      {r.lastHitAt ? (
                        <span className="block text-[11px] text-muted">
                          {formatWhen(r.lastHitAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setForm({ id: r.id, from: r.from, to: r.to, code: r.code })}
                      >
                        Tahrirlash
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === r.id}
                        onClick={() => {
                          if (!window.confirm(`${r.from} redirectini o'chirasizmi?`)) return;
                          void run(
                            r.id,
                            () => adminFetch(`/admin/seo/redirects/${r.id}`, { method: 'DELETE' }),
                            "O'chirildi.",
                          );
                        }}
                      >
                        O&apos;chirish
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        as="section"
        className="flex flex-col gap-3 p-5 sm:p-6"
        aria-labelledby="not-found-title"
        id="not-found"
      >
        <h2 id="not-found-title" className="text-xl font-semibold">
          {COPY.notFound} <span className="text-[13px] font-normal text-muted">· 7 kun</span>
        </h2>
        {notFound.length === 0 ? (
          <p className="rounded-md bg-off p-6 text-center text-[13px] text-muted">404 yo&apos;q.</p>
        ) : (
          <ul className="flex flex-col">
            {notFound.map((n) => (
              <li
                key={n.path}
                className="flex flex-col gap-1 border-b border-line-soft py-2.5 text-[13px]"
                data-testid="not-found-row"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs">{n.path}</code>
                  <Badge tone={n.internal ? 'critical' : 'neutral'}>{n.hits} marta</Badge>
                  {n.internal ? <Badge tone="warn">ichki havola</Badge> : null}
                </span>
                {n.referrer ? (
                  <span className="truncate text-[11px] text-muted">← {n.referrer}</span>
                ) : null}
                <span className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({ id: null, from: n.path, to: n.suggestion ?? '', code: 301 })
                    }
                    data-testid="not-found-create"
                  >
                    {n.suggestion ? `Redirect → ${n.suggestion}` : 'Redirect yaratish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `nf:${n.path}`}
                    onClick={() =>
                      void run(
                        `nf:${n.path}`,
                        () =>
                          adminFetch('/admin/seo/not-found/dismiss', {
                            method: 'POST',
                            body: { path: n.path },
                          }),
                        'Yashirildi.',
                      )
                    }
                  >
                    E&apos;tiborsiz qoldirish
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
