'use client';

import {
  MOYSKLAD_MIRRORED_STATUSES,
  type MoyskladFlow,
  type MoyskladLogEntryDto,
  type MoyskladLogPageDto,
  type MoyskladMirroredStatus,
  type MoyskladSettings,
  type MoyskladStatusDto,
  type MoyskladSyncScope,
} from '@forest/contracts/core';
import { Button, cn, Panel, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatLastSeen, formatWhen } from '../../lib/format';
import { Section } from '../page';
import { FLOW_ROWS, LOG_KIND_LABEL, RULES, STATUS_LABEL } from './copy';

const inputClass =
  'h-10 w-full rounded-sm border border-line bg-panel px-3 text-[13px] focus:border-ink focus:outline-none disabled:bg-off';

type SettingsForm = {
  priceType: string;
  ikpuAttribute: string;
  deliveryAttribute: string;
  storeId: string;
  organizationId: string;
  defaultCounterpartyId: string;
  stockPollMinutes: string;
  reserve: boolean;
  stateMap: Record<MoyskladMirroredStatus, string>;
};

function formOf(s: MoyskladSettings): SettingsForm {
  return {
    priceType: s.priceType,
    ikpuAttribute: s.ikpuAttribute,
    deliveryAttribute: s.deliveryAttribute,
    storeId: s.storeId ?? '',
    organizationId: s.organizationId ?? '',
    defaultCounterpartyId: s.defaultCounterpartyId ?? '',
    stockPollMinutes: String(s.stockPollMinutes),
    reserve: s.reserve,
    stateMap: { ...s.stateMap },
  };
}

const CONNECTION: Record<MoyskladStatusDto['connection'], { label: string; dot: string }> = {
  CONNECTED: { label: 'Ulangan', dot: 'bg-forest' },
  DISCONNECTED: { label: 'Ulanmagan', dot: 'bg-line' },
  ERROR: { label: 'Xato', dot: 'bg-critical' },
};

function Kpi({
  label,
  value,
  warn,
  testId,
}: {
  label: string;
  value: string;
  warn?: boolean;
  testId: string;
}) {
  return (
    <Panel
      className={cn('flex flex-col gap-2 p-[18px]', warn && 'bg-warn-bg text-warn')}
      data-testid={testId}
    >
      <span className={cn('text-xs', warn ? 'font-semibold' : 'text-muted')}>{label}</span>
      <b className="text-2xl font-semibold">{value}</b>
    </Panel>
  );
}

function Direction({ from, to }: { from: string; to: string }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold">
      <span className="rounded-sm bg-off px-2 py-1">{from}</span>
      <span aria-hidden="true">→</span>
      <span className="sr-only">dan</span>
      <span className="rounded-sm bg-off px-2 py-1">{to}</span>
    </span>
  );
}

/** A13 MoySklad page body (design Admin-MoySklad): every value comes from the API. */
export function MoyskladPanel({
  status: initial,
  log: initialLog,
  canEdit,
  canReveal,
}: {
  status: MoyskladStatusDto;
  log: MoyskladLogPageDto;
  canEdit: boolean;
  canReveal: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [form, setForm] = useState(() => formOf(initial.settings));
  const [log, setLog] = useState<MoyskladLogEntryDto[]>(initialLog.items);
  const [cursor, setCursor] = useState(initialLog.nextCursor);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const loadLog = useCallback(async (errorsOnly: boolean, after?: string | null) => {
    const q = new URLSearchParams({ limit: '30' });
    if (errorsOnly) q.set('ok', 'false');
    if (after) q.set('cursor', after);
    const page = await adminFetch<MoyskladLogPageDto>(`/admin/moysklad/log?${q.toString()}`);
    setLog((prev) => (after ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);

  async function refresh() {
    const next = await adminFetch<MoyskladStatusDto>('/admin/moysklad/status');
    setStatus(next);
    await loadLog(onlyErrors);
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const syncNow = (scope: MoyskladSyncScope) =>
    run(`sync-${scope}`, async () => {
      await adminFetch('/admin/moysklad/sync', { method: 'POST', body: { scope } });
      setMessage({ ok: true, text: "Sinxronlash navbatga qo'yildi — natija jurnalda ko'rinadi." });
      // The job runs in the API worker; pick its result up shortly after.
      for (const ms of [1500, 4000]) {
        await new Promise((r) => setTimeout(r, ms));
        await refresh();
      }
      startTransition(() => router.refresh());
    });

  const saveSettings = (body: Record<string, unknown>, key: string) =>
    run(key, async () => {
      const next = await adminFetch<MoyskladStatusDto>('/admin/moysklad/settings', {
        method: 'PATCH',
        body,
      });
      setStatus(next);
      setForm(formOf(next.settings));
      setMessage({ ok: true, text: 'Saqlandi.' });
    });

  const toggleFlow = (flow: MoyskladFlow, on: boolean) =>
    saveSettings({ flows: { [flow]: on } }, `flow-${flow}`);

  const submitSettings = () => {
    const minutes = Number(form.stockPollMinutes);
    void saveSettings(
      {
        priceType: form.priceType,
        ikpuAttribute: form.ikpuAttribute,
        deliveryAttribute: form.deliveryAttribute,
        storeId: form.storeId.trim(),
        organizationId: form.organizationId.trim(),
        defaultCounterpartyId: form.defaultCounterpartyId.trim(),
        stockPollMinutes: Number.isInteger(minutes) ? minutes : status.settings.stockPollMinutes,
        reserve: form.reserve,
        stateMap: form.stateMap,
      },
      'settings',
    );
  };

  const reveal = () =>
    run('reveal', async () => {
      const res = await adminFetch<{ webhookUrl: string }>('/admin/moysklad/webhook-url', {
        method: 'POST',
      });
      setWebhookUrl(res.webhookUrl);
    });

  const registerWebhooks = () =>
    run('register', async () => {
      const res = await adminFetch<{ created: number; existing: number }>(
        '/admin/moysklad/webhooks/register',
        { method: 'POST' },
      );
      setMessage({
        ok: true,
        text: `Webhooklar: ${res.created} ta yangi, ${res.existing} ta avvaldan bor.`,
      });
      await refresh();
    });

  const k = status.kpis;
  const conn = CONNECTION[status.connection];
  const errors = k.errors24h + k.ordersFailing;
  const s = status.settings;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex items-center gap-2 rounded-pill bg-panel px-4 py-2 text-[13px] font-semibold"
          data-testid="moysklad-connection"
        >
          <span className={cn('size-2 rounded-pill', conn.dot)} aria-hidden="true" />
          {conn.label}
          {status.usingFake ? ' · test rejimi (fake)' : ''}
        </span>
        <Button
          onClick={() => void syncNow('all')}
          loading={busy === 'sync-all'}
          data-testid="moysklad-sync-now"
        >
          {busy === 'sync-all' ? 'Sinxronlanmoqda…' : 'Hozir sinxronlash'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void syncNow('stock')}
          loading={busy === 'sync-stock'}
        >
          Faqat qoldiq
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void syncNow('orders')}
          loading={busy === 'sync-orders'}
        >
          Faqat buyurtmalar
        </Button>
      </div>

      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={cn(
            'rounded-md px-4 py-3 text-[13px]',
            message.ok ? 'bg-sage-50 text-ink' : 'bg-critical-bg text-critical',
          )}
        >
          {message.text}
        </p>
      ) : null}
      {status.connection !== 'CONNECTED' ? (
        <p className="rounded-md bg-warn-bg px-4 py-3 text-[13px] text-warn">
          MoySklad ulanmagan: API tokenni Integratsiyalar bo&apos;limida kiriting (faqat Egasi).
          {status.lastError ? ` Oxirgi xato: ${status.lastError}` : ''}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          testId="moysklad-kpi-last"
          label="Oxirgi sinxron"
          value={k.lastSyncAt ? formatLastSeen(k.lastSyncAt) : '—'}
        />
        <Kpi
          testId="moysklad-kpi-linked"
          label="Bog'langan SKU"
          value={`${k.linkedSkus} / ${k.totalSkus}`}
        />
        <Kpi
          testId="moysklad-kpi-orders"
          label="Bugun yuborilgan buyurtma"
          value={String(k.ordersPushedToday)}
        />
        <Kpi
          testId="moysklad-kpi-errors"
          label={errors ? "Xato · e'tibor kerak" : 'Xatolar (24 soat)'}
          value={String(errors)}
          warn={errors > 0}
        />
      </div>

      <Section title="Ma'lumot oqimi">
        <ul className="flex flex-col">
          {FLOW_ROWS.map((row) => (
            <li
              key={row.flow}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-line py-3 md:grid-cols-[1fr_auto_160px_auto]"
            >
              <div>
                <p className="font-semibold">{row.title}</p>
                <p className="text-xs text-muted">{row.hint}</p>
              </div>
              <div className="hidden md:block">
                <Direction from={row.from} to={row.to} />
              </div>
              <span className="hidden text-[13px] md:block">
                {row.cadence(s.stockPollMinutes, s.flows.webhooks)}
              </span>
              <Switch
                checked={s.flows[row.flow]}
                disabled={!canEdit || busy !== null}
                onCheckedChange={(on) => void toggleFlow(row.flow, on)}
                aria-label={`${row.title}: ${s.flows[row.flow] ? "o'chirish" : 'yoqish'}`}
              />
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Section title="Maydonlar mosligi">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Forest sayt</th>
                <th className="py-2 font-normal">MoySklad</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Mahsulot nomi (UZ/RU)', 'product.name (faqat yangi qoralama)'],
                ['SKU', 'product.article · variant.code'],
                ['IKPU (MXIK)', `attributes.${s.ikpuAttribute}`],
                ['Narx', `salePrices[${s.priceType}]`],
                [
                  'Qoldiq',
                  s.storeId ? 'stock − reserve (ombor)' : 'stock − reserve (barcha omborlar)',
                ],
                ['Buyurtma raqami', 'customerorder.name'],
                ['Mijoz telefoni', 'counterparty.phone'],
                [
                  'Yetkazish usuli',
                  s.deliveryAttribute ? `attributes.${s.deliveryAttribute}` : '— (yuborilmaydi)',
                ],
              ].map(([ours, theirs]) => (
                <tr key={ours} className="border-t border-line">
                  <td className="py-2.5 font-semibold">{ours}</td>
                  <td className="py-2.5 font-mono text-xs">{theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <form
            className="mt-4 grid gap-3 rounded-md bg-off p-4 sm:grid-cols-2"
            aria-label="MoySklad sozlamalari"
            onSubmit={(e) => {
              e.preventDefault();
              submitSettings();
            }}
          >
            {(
              [
                ['priceType', 'Narx turi (salePrices)', 'Chakana'],
                ['ikpuAttribute', "IKPU qo'shimcha maydoni", 'ikpu'],
                [
                  'deliveryAttribute',
                  "Yetkazish qo'shimcha maydoni (bo'sh = yubormaslik)",
                  'dostavka',
                ],
                ['storeId', "Ombor ID (bo'sh = barcha omborlar)", 'xxxxxxxx-xxxx-…'],
                ['organizationId', "Yuridik shaxs ID (bo'sh = birinchisi)", 'xxxxxxxx-xxxx-…'],
                [
                  'defaultCounterpartyId',
                  "Standart kontragent ID (Mijozlar oqimi o'chiq bo'lsa)",
                  'xxxxxxxx-xxxx-…',
                ],
                ['stockPollMinutes', "Qoldiqni so'rash oralig'i (daq, 1–60)", '5'],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key} className="flex flex-col gap-1.5 text-xs font-semibold">
                {label}
                <input
                  name={key}
                  value={form[key]}
                  placeholder={placeholder}
                  disabled={!canEdit}
                  inputMode={key === 'stockPollMinutes' ? 'numeric' : undefined}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className={inputClass}
                />
              </label>
            ))}
            <div className="flex items-center gap-3 text-xs font-semibold">
              <Switch
                checked={form.reserve}
                disabled={!canEdit}
                onCheckedChange={(on) => setForm({ ...form, reserve: on })}
                aria-label="Buyurtma pozitsiyalarini MoySklad'da rezervlash"
              />
              <span aria-hidden="true">Buyurtmani MoySklad&apos;da rezervlash</span>
            </div>

            <fieldset className="col-span-full flex flex-col gap-2">
              <legend className="pb-2 text-xs font-semibold">
                Holatlar mosligi (sayt → MoySklad statusi nomi; bo&apos;sh = o&apos;zgartirmaslik)
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {MOYSKLAD_MIRRORED_STATUSES.map((st) => (
                  <label key={st} className="grid grid-cols-[130px_1fr] items-center gap-2 text-xs">
                    <span className="font-semibold">{STATUS_LABEL[st]}</span>
                    <input
                      value={form.stateMap[st]}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setForm({ ...form, stateMap: { ...form.stateMap, [st]: e.target.value } })
                      }
                      className={inputClass}
                      aria-label={`${STATUS_LABEL[st]} → MoySklad statusi`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {canEdit ? (
              <div className="col-span-full flex gap-2">
                <Button type="submit" size="sm" loading={busy === 'settings'}>
                  Saqlash
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm(formOf(status.settings))}
                >
                  Bekor qilish
                </Button>
              </div>
            ) : (
              <p className="col-span-full text-xs text-muted">
                Sozlamalarni Egasi yoki Menejer o&apos;zgartiradi.
              </p>
            )}
          </form>
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Qoidalar">
            <dl className="flex flex-col">
              {RULES.map((r) => (
                <div key={r.label} className="flex justify-between gap-4 border-t border-line py-3">
                  <dt className="text-muted">{r.label}</dt>
                  <dd className="text-right font-semibold">{r.value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-line py-3">
                <dt className="text-muted">Admin tahriri</dt>
                <dd className="text-right font-semibold">
                  {status.sourceOfTruth.source === 'moysklad'
                    ? `Narx ${status.sourceOfTruth.price ? 'yopiq' : 'ochiq'}, qoldiq ${status.sourceOfTruth.stock ? 'yopiq' : 'ochiq'}`
                    : 'Katalog saytda boshqariladi'}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Ulanish">
            <dl className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">API token</dt>
                <dd className="rounded-sm bg-off px-2 py-1 font-mono text-xs">
                  {status.connectionInfo.tokenMasked ?? '—'}
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <dt className="text-muted">Webhook</dt>
                <dd
                  className="max-w-full break-all rounded-sm bg-off px-2 py-1 font-mono text-xs"
                  data-testid="moysklad-webhook-url"
                >
                  {webhookUrl ?? status.connectionInfo.webhookUrlMasked ?? '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
              {canReveal && status.connectionInfo.webhookUrlMasked && !webhookUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void reveal()}
                  loading={busy === 'reveal'}
                >
                  To&apos;liq URL&apos;ni ko&apos;rsatish
                </Button>
              ) : null}
              {canEdit && status.connection === 'CONNECTED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void registerWebhooks()}
                  loading={busy === 'register'}
                >
                  Webhooklarni MoySklad&apos;da yaratish
                </Button>
              ) : null}
            </div>
            <p className="mt-2 rounded-md bg-sage-50 px-3 py-2 text-xs text-muted">
              Token serverda shifrlangan saqlanadi, admin panelda faqat oxirgi 4 belgi
              ko&apos;rinadi. Webhook manzilidagi maxfiy qismni faqat Egasi ochadi (jurnalga
              yoziladi).
            </p>
          </Section>
        </div>
      </div>

      <Section
        title="Sinxron jurnali"
        actions={
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Switch
              checked={onlyErrors}
              onCheckedChange={(on) => {
                setOnlyErrors(on);
                void run('log', () => loadLog(on));
              }}
              aria-label="Faqat xatolar"
            />
            <span aria-hidden="true">Faqat xatolar</span>
          </div>
        }
      >
        {log.length === 0 ? (
          <p className="py-6 text-center text-muted">Jurnal hozircha bo&apos;sh.</p>
        ) : (
          <ul className="flex flex-col">
            {log.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[90px_1fr_auto] items-start gap-3 border-t border-line py-3 sm:grid-cols-[110px_110px_1fr_auto]"
                data-testid="moysklad-log-row"
              >
                <time className="text-muted" dateTime={row.at}>
                  {formatWhen(row.at)}
                </time>
                <span className="hidden font-semibold sm:block">
                  {LOG_KIND_LABEL[row.kind] ?? row.kind}
                </span>
                <span className="break-words">{row.message}</span>
                <span
                  className={cn(
                    'rounded-pill px-2.5 py-1 text-[11px] font-bold',
                    row.ok ? 'bg-sage-50 text-forest' : 'bg-critical-bg text-critical',
                  )}
                >
                  {row.ok ? 'OK' : 'Xato'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {cursor ? (
          <div className="pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run('more', () => loadLog(onlyErrors, cursor))}
              loading={busy === 'more'}
            >
              Ko&apos;proq
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
