'use client';

import {
  type AdminPromoDto,
  type AdminPromoSummaryDto,
  PROMO_AUDIENCES,
  PROMO_TYPES,
  type PromoAudience,
  type PromoType,
} from '@forest/contracts/core';
import { Badge, Button, cn, Field, Input, Panel } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, errorText } from '../../lib/client-api';
import { compactInput, NumberInput, selectClass } from '../products/fields';
import { fromDateTimeInput, soum, toDateTimeInput } from '../products/format';
import { AUDIENCE_LABEL, COPY, PROMO_TYPE_LABEL, STATE_LABEL, STATE_TONE } from './copy';

interface Draft {
  code: string;
  type: PromoType;
  value: number | null;
  giftVariantId: string;
  minCartSoum: number | null;
  audience: PromoAudience;
  segmentId: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: string;
  endsAt: string;
  utmSource: string;
}

const draftOf = (p: AdminPromoDto | null): Draft => ({
  code: p?.code ?? '',
  type: p?.type ?? 'PERCENT',
  value: p ? p.value : 10,
  giftVariantId: p?.gift?.variantId ?? '',
  minCartSoum: p?.minCartSoum ?? 0,
  audience: p?.audience ?? 'ALL',
  segmentId: p?.segmentId ?? '',
  usageLimit: p?.usageLimit ?? null,
  perCustomerLimit: p?.perCustomerLimit ?? 1,
  startsAt: toDateTimeInput(p?.startsAt ?? null),
  endsAt: toDateTimeInput(p?.endsAt ?? null),
  utmSource: p?.utmSource ?? '',
});

/** A14 editor (design Admin-Promo): type, value, min cart, audience, limits, dates, UTM, rules. */
export function PromoEditor({
  promo,
  summary,
}: {
  promo: AdminPromoDto | null;
  summary: AdminPromoSummaryDto;
}) {
  const router = useRouter();
  const [initial] = useState(() => draftOf(promo));
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const max = summary.rules.maxDiscountPct;

  async function send(key: string, body: object) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const saved = promo
        ? await adminFetch<AdminPromoDto>(`/admin/promo/${promo.id}`, { method: 'PATCH', body })
        : await adminFetch<AdminPromoDto>('/admin/promo', { method: 'POST', body });
      setNotice(COPY.saved);
      if (!promo) router.push(`/promo?id=${saved.id}`);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send('save', {
      code: d.code,
      type: d.type,
      value: d.type === 'PERCENT' || d.type === 'FIXED' ? (d.value ?? 0) : 0,
      giftVariantId: d.type === 'GIFT' ? d.giftVariantId || null : null,
      minCartSoum: d.minCartSoum ?? 0,
      audience: d.audience,
      segmentId: d.audience === 'SEGMENT' ? d.segmentId || null : null,
      usageLimit: d.usageLimit,
      perCustomerLimit: d.perCustomerLimit ?? 1,
      // Untouched dates are not re-sent: the inputs have minute precision and would round off
      // an exact stored time (e.g. 23:59:59) on every save.
      ...(!promo || d.startsAt !== initial.startsAt
        ? { startsAt: fromDateTimeInput(d.startsAt) }
        : {}),
      ...(!promo || d.endsAt !== initial.endsAt ? { endsAt: fromDateTimeInput(d.endsAt) } : {}),
      utmSource: d.utmSource.trim(),
    });
  }

  const gift = summary.giftOptions.find((g) => g.variantId === d.giftVariantId);
  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px] xl:sticky xl:top-4"
      aria-label="Promo-kod muharriri"
      data-testid="promo-editor"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-2xl font-bold">{promo ? promo.code : 'Yangi kod'}</h2>
          {promo ? <Badge tone={STATE_TONE[promo.state]}>{STATE_LABEL[promo.state]}</Badge> : null}
        </div>
        <FormError message={error} />
        {notice ? (
          <p role="status" className="rounded-sm bg-good-bg px-3 py-2 font-semibold text-good">
            {notice}
          </p>
        ) : null}

        <Field
          label="Kod"
          hint={promo?.locked ? COPY.lockedHint : 'Lotin harflari, raqam, - _ (3–32)'}
        >
          {(p) => (
            <Input
              {...p}
              className={cn(compactInput, 'font-mono uppercase')}
              required
              pattern="[A-Za-z0-9_\-]{3,32}"
              value={d.code}
              disabled={promo?.locked}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              data-testid="promo-code"
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 font-semibold">Turi</legend>
          <div className="grid grid-cols-2 gap-2">
            {PROMO_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={d.type === t}
                onClick={() => set('type', t)}
                className={cn(
                  'h-10 rounded-sm text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-forest',
                  d.type === t ? 'bg-ink text-white' : 'bg-canvas hover:bg-sage',
                )}
              >
                {PROMO_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {d.type === 'PERCENT' || d.type === 'FIXED' ? (
            <Field label={d.type === 'PERCENT' ? `Qiymat, % (≤ ${max})` : "Qiymat, so'm"}>
              {(p) => (
                <NumberInput
                  {...p}
                  min={1}
                  required
                  value={d.value}
                  onChange={(v) => set('value', v)}
                  data-testid="promo-value"
                />
              )}
            </Field>
          ) : d.type === 'GIFT' ? (
            <Field label="Sovg'a" hint={gift ? `${soum(gift.priceSoum)} so'm` : undefined}>
              {(p) => (
                <select
                  {...p}
                  className={selectClass}
                  required
                  value={d.giftVariantId}
                  onChange={(e) => set('giftVariantId', e.target.value)}
                >
                  <option value="">—</option>
                  {summary.giftOptions.map((g) => (
                    <option key={g.variantId} value={g.variantId}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <p className="self-end text-muted">
              Yetkazish narxi 0 bo&apos;ladi (to&apos;plamlar bilan qo&apos;shilmaydi).
            </p>
          )}
          <Field
            label="Min. savat, so'm"
            hint={
              d.type === 'FIXED' || d.type === 'GIFT'
                ? `Chegirma min. savatning ${max}% idan oshmasin`
                : undefined
            }
          >
            {(p) => (
              <NumberInput
                {...p}
                min={0}
                value={d.minCartSoum}
                onChange={(v) => set('minCartSoum', v)}
              />
            )}
          </Field>
          <Field label="Kimga">
            {(p) => (
              <select
                {...p}
                className={selectClass}
                value={d.audience}
                onChange={(e) => set('audience', e.target.value as PromoAudience)}
              >
                {PROMO_AUDIENCES.filter((a) => a !== 'SEGMENT' || summary.segments.length > 0).map(
                  (a) => (
                    <option key={a} value={a}>
                      {AUDIENCE_LABEL[a]}
                    </option>
                  ),
                )}
              </select>
            )}
          </Field>
          {d.audience === 'SEGMENT' ? (
            <Field label="Segment">
              {(p) => (
                <select
                  {...p}
                  className={selectClass}
                  required
                  value={d.segmentId}
                  onChange={(e) => set('segmentId', e.target.value)}
                >
                  <option value="">—</option>
                  {summary.segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <Field
              label="Limit / mijoz"
              hint={d.audience === 'FIRST_ORDER' ? '1 (yangi mijoz kodi)' : undefined}
            >
              {(p) => (
                <NumberInput
                  {...p}
                  min={1}
                  value={d.audience === 'FIRST_ORDER' ? 1 : d.perCustomerLimit}
                  disabled={d.audience === 'FIRST_ORDER'}
                  onChange={(v) => set('perCustomerLimit', v)}
                />
              )}
            </Field>
          )}
          <Field label="Umumiy limit" hint="Bo'sh — cheksiz">
            {(p) => (
              <NumberInput
                {...p}
                min={1}
                value={d.usageLimit}
                onChange={(v) => set('usageLimit', v)}
              />
            )}
          </Field>
          <Field label="Manba (UTM)">
            {(p) => (
              <Input
                {...p}
                className={compactInput}
                maxLength={64}
                value={d.utmSource}
                placeholder="bot, instagram…"
                onChange={(e) => set('utmSource', e.target.value)}
              />
            )}
          </Field>
          <Field label="Boshlanishi" hint={!d.startsAt && !d.endsAt ? COPY.unlimited : undefined}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                className={compactInput}
                value={d.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
              />
            )}
          </Field>
          <Field label="Tugashi">
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                className={compactInput}
                value={d.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-1 rounded-md bg-off p-4">
          <b className="font-semibold">{COPY.rules}</b>
          <span>✓ {COPY.ruleStack}</span>
          <span>✓ {COPY.ruleGuard.replace('{max}', String(max))}</span>
          <span>✓ {COPY.ruleDevice}</span>
        </div>

        {promo ? (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-line-soft p-3 text-center">
            <span className="flex flex-col">
              <b className="tabular text-base">{promo.stats.uses}</b>
              <span className="text-xs text-muted">ishlatildi</span>
            </span>
            <span className="flex flex-col">
              <b className="tabular text-base">{soum(promo.stats.discountSoum)}</b>
              <span className="text-xs text-muted">chegirma, so&apos;m</span>
            </span>
            <span className="flex flex-col">
              <b className="tabular text-base">{soum(promo.stats.revenueSoum)}</b>
              <span className="text-xs text-muted">daromad, so&apos;m</span>
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {promo ? (
            <Button
              type="button"
              variant="outline"
              block
              loading={busy === 'toggle'}
              onClick={() => {
                if (promo.active && !window.confirm(COPY.pauseConfirm)) return;
                void send('toggle', { active: !promo.active });
              }}
              data-testid="promo-toggle"
            >
              {promo.active ? COPY.pause : COPY.resume}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" block loading={busy === 'save'} data-testid="promo-save">
            {COPY.save}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
