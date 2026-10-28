'use client';

import {
  INTEGRATION_CATEGORIES,
  type IntegrationCardDto,
  type IntegrationCategoryKey,
  type IntegrationDetailDto,
  type IntegrationsHubDto,
  type IntegrationTestResultDto,
} from '@forest/contracts/core';
import { Badge, Button, Chip, cn, Panel } from '@forest/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { FormError } from '../auth-card';
import { ConfirmDialog } from '../customers/confirm-dialog';
import { CATEGORY_LABEL, markOf, readyNoteText, STATUS_LABEL, STATUS_TONE } from './copy';

type Filter = 'all' | 'connected' | IntegrationCategoryKey;

function Mark({ card, size = 40 }: { card: IntegrationCardDto; size?: number }) {
  const text = markOf(card);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-sm font-bold tracking-tight text-white',
        text.length > 2 ? 'text-[10px]' : 'text-sm',
        card.status === 'CONNECTED' ? 'bg-forest' : 'bg-ink-2',
      )}
    >
      {text}
    </span>
  );
}

/**
 * A10 hub: launch kit, search + category chips (URL-synced: `?q=&cat=&key=`), card grid and the
 * detail panel. Credentials are editable only with `integrations.keys` (Owner); secrets are shown
 * masked and blank secret inputs keep the stored value.
 */
export function IntegrationsHub({
  hub,
  canKeys,
  developer,
}: {
  hub: IntegrationsHubDto;
  canKeys: boolean;
  /** Webhooks / API keys / key security row (server-rendered, `DeveloperSummary`). */
  developer?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const catParam = params.get('cat') ?? 'all';
  const cat: Filter =
    catParam === 'connected' || (INTEGRATION_CATEGORIES as readonly string[]).includes(catParam)
      ? (catParam as Filter)
      : 'all';
  const selectedKey = params.get('key');
  const [search, setSearch] = useState(q);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || (k === 'cat' && v === 'all')) next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounced search → URL.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParams({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [search, q, setParams]);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>([
      ['all', hub.items.length],
      ['connected', hub.connected],
    ]);
    for (const c of INTEGRATION_CATEGORIES)
      m.set(c, hub.items.filter((i) => i.category === c).length);
    return m;
  }, [hub]);

  const needle = q.trim().toLowerCase();
  const shown = hub.items.filter(
    (i) =>
      (cat === 'all' || (cat === 'connected' ? i.status === 'CONNECTED' : i.category === cat)) &&
      (!needle ||
        i.name.toLowerCase().includes(needle) ||
        i.description.uz.toLowerCase().includes(needle) ||
        CATEGORY_LABEL[i.category].toLowerCase().includes(needle)),
  );
  const kit = hub.items.filter((i) => i.launchKit);
  const selected = hub.items.find((i) => i.key === selectedKey) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        tone="dark"
        className="flex flex-wrap items-center gap-6 p-6"
        aria-label="Ishga tushirish to'plami"
      >
        <div className="flex min-w-[240px] flex-1 flex-col gap-2">
          <span className="text-[11px] font-semibold tracking-[0.1em] text-on-dark-muted uppercase">
            Ishga tushirish to&apos;plami
          </span>
          <b
            className="text-[28px] font-medium tracking-[-0.03em]"
            data-testid="launch-kit-progress"
          >
            {hub.launchKit.ready} / {hub.launchKit.total} tayyor
          </b>
          <span className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-pill bg-dark-3">
            <span
              className="block h-full rounded-pill bg-sage"
              style={{
                width: `${hub.launchKit.total ? (hub.launchKit.ready / hub.launchKit.total) * 100 : 0}%`,
              }}
            />
          </span>
          <span className="text-xs text-on-dark-muted">Bular ulanmaguncha sayt ochilmaydi.</span>
        </div>
        <ul className="flex max-w-[640px] flex-wrap gap-2">
          {kit.map((k) => (
            <li key={k.key}>
              <button
                type="button"
                onClick={() =>
                  k.dedicatedPage ? router.push(k.dedicatedPage) : setParams({ key: k.key })
                }
                title={readyNoteText(k.readyNote) ?? STATUS_LABEL[k.status]}
                className={cn(
                  'rounded-pill border px-3 py-1.5 text-xs font-semibold',
                  k.ready ? 'border-dark-3 text-white' : 'border-warn-bg text-warn-bg',
                )}
              >
                {k.ready ? '✓' : '○'} {k.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-pill bg-panel px-4 sm:max-w-[320px]">
          <span className="sr-only">Xizmat nomi</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Xizmat nomi"
            className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
          />
        </label>
        {(['all', 'connected', ...INTEGRATION_CATEGORIES] as Filter[]).map((f) => (
          <Chip
            key={f}
            surface="canvas"
            selected={cat === f}
            onClick={() => setParams({ cat: f })}
            className="h-8 px-3 text-xs"
          >
            {f === 'all' ? 'Hammasi' : f === 'connected' ? 'Ulangan' : CATEGORY_LABEL[f]}{' '}
            <span className="opacity-60">{counts.get(f)}</span>
          </Chip>
        ))}
      </div>

      {selected ? (
        <DetailPanel
          key={selected.key}
          card={selected}
          canKeys={canKeys}
          fakeMode={hub.fakeMode}
          onClose={() => setParams({ key: null })}
          onChanged={() => router.refresh()}
        />
      ) : null}

      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
        data-testid="integration-grid"
      >
        {shown.map((c) => {
          const active = c.key === selectedKey;
          const body = (
            <>
              <span className="flex items-start gap-2.5">
                <Mark card={c} />
                <span className="flex min-w-0 flex-col">
                  <b className="font-semibold">{c.name}</b>
                  <span className="text-xs text-muted">{CATEGORY_LABEL[c.category]}</span>
                </span>
              </span>
              <span className="line-clamp-3 text-xs text-ink-2">{c.description.uz}</span>
              <span className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[c.status]} className="h-5 text-[11px]">
                  {STATUS_LABEL[c.status]}
                </Badge>
                {c.launchKit ? (
                  <Badge tone="sage" className="h-5 text-[11px]">
                    To&apos;plam
                  </Badge>
                ) : null}
                {c.dedicatedPage ? (
                  <span className="text-[11px] text-forest">Alohida sahifa →</span>
                ) : null}
              </span>
            </>
          );
          const cls = cn(
            'flex h-full min-h-[150px] w-full flex-col gap-2 rounded-md bg-panel p-4 text-left text-[13px] transition-shadow hover:shadow-float',
            active && 'outline-2 outline-ink',
          );
          return (
            <li key={c.key} data-testid={`integration-${c.key}`}>
              {c.dedicatedPage ? (
                <Link href={c.dedicatedPage} prefetch={false} className={cls}>
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParams({ key: active ? null : c.key })}
                  className={cls}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-muted">Hech narsa topilmadi.</p>
      ) : null}

      {developer}
    </div>
  );
}

function DetailPanel({
  card,
  canKeys,
  fakeMode,
  onClose,
  onChanged,
}: {
  card: IntegrationCardDto;
  canKeys: boolean;
  fakeMode: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<IntegrationDetailDto | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntegrationTestResultDto | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'disconnect' | 'reveal' | null>(
    'load',
  );
  const [confirming, setConfirming] = useState(false);
  const [secretUrl, setSecretUrl] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const load = useCallback(async () => {
    setBusy('load');
    try {
      const d = await adminFetch<IntegrationDetailDto>(`/admin/integrations/${card.key}`);
      setDetail(d);
      // Text/select fields start with the stored value; secrets start blank (blank = keep).
      setValues(
        Object.fromEntries(
          d.fields.map((f) => [f.key, f.type === 'secret' ? '' : (f.value ?? '')]),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [card.key]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setResult(null);
    try {
      setResult(
        await adminFetch<IntegrationTestResultDto>(`/admin/integrations/${card.key}`, {
          method: 'PUT',
          body: { fields: values },
        }),
      );
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setError(null);
    setResult(null);
    try {
      setResult(
        await adminFetch<IntegrationTestResultDto>(`/admin/integrations/${card.key}/test`, {
          method: 'POST',
        }),
      );
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      await adminFetch(`/admin/integrations/${card.key}/disconnect`, {
        method: 'POST',
        body: { confirm: card.key },
      });
      setConfirming(false);
      setResult(null);
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  }

  async function revealUrl() {
    setBusy('reveal');
    setError(null);
    try {
      setSecretUrl(
        (
          await adminFetch<{ url: string }>(`/admin/integrations/${card.key}/webhook-url`, {
            method: 'POST',
          })
        ).url,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const connected = detail?.status === 'CONNECTED' || detail?.status === 'ERROR';
  const note = readyNoteText(card.readyNote);

  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]"
      aria-label={`${card.name} sozlamalari`}
      data-testid="integration-detail"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Mark card={card} size={48} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-xl font-semibold">{card.name}</h2>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge
              tone={STATUS_TONE[detail?.status ?? card.status]}
              data-testid="integration-status"
            >
              {STATUS_LABEL[detail?.status ?? card.status]}
            </Badge>
            {card.launchKit ? (
              <Badge tone="sage">Ishga tushirish to&apos;plamiga kiradi</Badge>
            ) : null}
            {fakeMode ? (
              <Badge tone="info">Test muhiti: tashqi so&apos;rov yuborilmaydi</Badge>
            ) : null}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Yopish
        </Button>
      </div>
      <p className="text-ink-2">{card.description.uz}</p>
      {note ? <p className="rounded-sm bg-sage-50 px-3 py-2">{note}</p> : null}
      {detail?.lastError ? (
        <p className="rounded-sm bg-critical-bg px-3 py-2 text-critical">
          Oxirgi tekshiruv xatosi{detail.lastCheckAt ? ` (${formatWhen(detail.lastCheckAt)})` : ''}:{' '}
          {detail.lastError}
        </p>
      ) : null}

      {busy === 'load' && !detail ? <p className="text-muted">Yuklanmoqda…</p> : null}

      {detail && detail.availability === 'coming_soon' ? (
        <p className="text-muted">Bu integratsiya tez orada qo&apos;shiladi.</p>
      ) : null}
      {detail &&
      detail.availability === 'available' &&
      detail.fields.length === 0 &&
      !card.readyNote ? (
        <p className="text-muted">
          Ulash uchun sozlama talab qilinmaydi yoki adapter hali tayyor emas (tez orada).
        </p>
      ) : null}

      {detail && detail.connectable ? (
        <form onSubmit={save} className="flex flex-col gap-3" aria-label={`${card.name} kalitlari`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {detail.fields.map((f) => {
              const id = `int-${card.key}-${f.key}`;
              const stored = f.value;
              return (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-xs font-semibold">
                    {f.label.uz}
                    {f.required ? <span className="text-critical"> *</span> : null}
                  </label>
                  {f.type === 'select' ? (
                    <select
                      id={id}
                      disabled={!canKeys}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="h-10 rounded-xs border border-line bg-panel px-2 font-mono text-xs focus:border-ink focus:outline-none disabled:bg-off"
                    >
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ||
                    (f.type === 'secret' && f.key.toLowerCase().includes('json')) ? (
                    <textarea
                      id={id}
                      readOnly={!canKeys}
                      value={values[f.key] ?? ''}
                      placeholder={stored ?? (f.type === 'secret' ? 'kiritilmagan' : '')}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="min-h-10 rounded-xs border border-line bg-panel px-2 py-2 font-mono text-xs focus:border-ink focus:outline-none read-only:bg-off"
                    />
                  ) : (
                    <input
                      id={id}
                      type={f.type === 'secret' ? 'password' : 'text'}
                      readOnly={!canKeys}
                      value={values[f.key] ?? ''}
                      placeholder={stored ?? (f.type === 'secret' ? 'kiritilmagan' : '')}
                      autoComplete={f.type === 'secret' ? 'new-password' : 'off'}
                      spellCheck={false}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="h-10 rounded-xs border border-line bg-panel px-2 font-mono text-xs focus:border-ink focus:outline-none read-only:bg-off"
                    />
                  )}
                  {f.type === 'secret' ? (
                    <span className="text-[11px] text-muted" data-testid={`masked-${f.key}`}>
                      {stored
                        ? `Saqlangan: ${stored} · bo'sh qoldirsangiz o'zgarmaydi`
                        : 'Saqlanmagan'}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {detail.webhook ? (
            <div className="flex flex-col gap-1.5 rounded-sm bg-off p-3">
              <span className="text-xs font-semibold">Callback URL</span>
              {detail.webhook.url ? (
                <>
                  <code className="font-mono text-xs break-all">{detail.webhook.url}</code>
                  {detail.webhook.urls.map((u) => (
                    <code key={u} className="font-mono text-xs break-all">
                      {u}
                    </code>
                  ))}
                  <span className="text-[11px] text-muted">
                    Provayder kabinetiga shu manzilni kiriting.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-muted">
                    Manzilda maxfiy kalit bor
                    {detail.webhook.automatic
                      ? ' va u har so‘rov bilan avtomatik yuboriladi — kabinetga kiritish shart emas'
                      : ''}
                    .
                  </span>
                  {secretUrl ? (
                    <code className="font-mono text-xs break-all" data-testid="secret-webhook-url">
                      {secretUrl}
                    </code>
                  ) : canKeys ? (
                    <span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void revealUrl()}
                        loading={busy === 'reveal'}
                      >
                        Manzilni ko&apos;rsatish (jurnalga yoziladi)
                      </Button>
                    </span>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {result ? (
            <p
              role="status"
              className={cn(
                'rounded-sm px-3 py-2',
                result.ok ? 'bg-good-bg text-good' : 'bg-critical-bg text-critical',
              )}
            >
              {result.ok ? 'Tekshiruv muvaffaqiyatli' : 'Tekshiruv xatosi'}: {result.message}
            </p>
          ) : null}
          <FormError message={error} />

          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <Button
                variant="outline"
                onClick={() => void test()}
                loading={busy === 'test'}
                block={false}
                className="min-w-[160px]"
              >
                Test qilish
              </Button>
            ) : null}
            {canKeys ? (
              <Button type="submit" loading={busy === 'save'} className="min-w-[160px]">
                {connected ? 'Saqlash va tekshirish' : 'Ulash'}
              </Button>
            ) : (
              <span className="text-xs text-muted">
                Kalitlarni faqat Egasi o&apos;zgartira oladi.
              </span>
            )}
            {canKeys && connected ? (
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                className="min-w-[120px]"
              >
                Uzish
              </Button>
            ) : null}
            {detail.docsUrl ? (
              <a
                href={detail.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs text-forest underline"
              >
                Provayder hujjatlari
              </a>
            ) : null}
          </div>
        </form>
      ) : (
        <FormError message={error} />
      )}

      {detail && detail.logs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={showLogs}
            onClick={() => setShowLogs((v) => !v)}
            className="w-fit text-xs font-semibold text-forest underline underline-offset-2"
          >
            Hodisalar jurnali ({detail.logs.length}) {showLogs ? '↑' : '→'}
          </button>
          {showLogs ? (
            <ul className="flex flex-col" data-testid="integration-logs">
              {detail.logs.map((l) => (
                <li
                  key={l.id}
                  className="grid grid-cols-[96px_70px_minmax(0,1fr)] gap-2 border-t border-line-soft py-1.5 text-xs"
                >
                  <time dateTime={l.at} className="text-muted">
                    {formatWhen(l.at)}
                  </time>
                  <span className={l.ok ? 'text-good' : 'text-critical'}>
                    {l.direction} · {l.ok ? 'OK' : 'Xato'}
                  </span>
                  <span className="min-w-0 break-words">
                    <b className="font-semibold">{l.kind}</b> — {l.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={`${card.name} uzilsinmi?`}
        confirmLabel="Uzish"
        typed={card.key}
        danger
        busy={busy === 'disconnect'}
        error={confirming ? error : null}
        onConfirm={() => void disconnect()}
        onClose={() => setConfirming(false)}
      >
        <p>
          Saqlangan kalitlar o&apos;chiriladi va integratsiya ishlamay qoladi (to&apos;lov
          webhooklari, SMS yoki yetkazish). Qayta ulash uchun kalitlarni yana kiritish kerak.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
