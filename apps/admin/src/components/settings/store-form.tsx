'use client';

import type { StoreSettingsDto } from '@forest/contracts/core';
import { Badge, Button, cn, Panel } from '@forest/ui';
import { type FormEvent, type ReactNode, useState } from 'react';
import { adminFetch, ClientApiError, errorText } from '../../lib/client-api';
import { FormError } from '../auth-card';

type Store = StoreSettingsDto['value'];

const input =
  'h-11 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none aria-[invalid=true]:border-danger';

/** Field label → path in the API's VALIDATION_FAILED `field` (`value.legal.stir`…). */
const FIELD_LABEL: Record<string, string> = {
  'value.name': "Do'kon nomi",
  'value.domain': 'Domen',
  'value.phone': 'Telefon',
  'value.email': 'Email',
  'value.telegramBot': 'Telegram bot',
  'value.legal.stir': 'STIR (9 raqam)',
  'value.legal.mfo': 'MFO (5 raqam)',
  'value.legal.account': 'Hisob raqam (20 raqam)',
  'value.offerVersion': 'Oferta versiyasi',
  'value.deletionSlaDays': "O'chirish muddati (1–30 kun)",
};

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = `store-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </div>
  );
}

/** A16 "Do'kon": store info + legal entity (Owner). Blank legal fields = not filled (draft). */
export function StoreForm({ initial }: { initial: StoreSettingsDto }) {
  const [doc, setDoc] = useState(initial);
  const [v, setV] = useState<Store>(initial.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badField, setBadField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Store>(k: K, value: Store[K]) => {
    setSaved(false);
    setV((cur) => ({ ...cur, [k]: value }));
  };
  const setLegal = (k: keyof Store['legal'], value: string) => {
    setSaved(false);
    setV((cur) => ({ ...cur, legal: { ...cur.legal, [k]: value } }));
  };
  const invalid = (path: string) => (badField === path ? true : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBadField(null);
    try {
      const next = await adminFetch<StoreSettingsDto>('/admin/settings/store', {
        method: 'PUT',
        body: { value: v, version: doc.version },
      });
      setDoc(next);
      setV(next.value);
      setSaved(true);
    } catch (err) {
      const field =
        err instanceof ClientApiError
          ? (err.details?.issues as { path: string }[] | undefined)?.[0]?.path
          : undefined;
      const path = field ? `value.${field.replace(/^value\./, '')}` : null;
      setBadField(path);
      setError(
        path && FIELD_LABEL[path] ? `${FIELD_LABEL[path]}: ${errorText(err)}` : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const legalFilled = Object.values(v.legal).every((x) => typeof x === 'string' && x.trim() !== '');

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Do'kon sozlamalari">
      <Panel as="section" className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]">
        <h2 className="text-xl font-semibold">Do&apos;kon</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Row label="Do'kon nomi">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.name}
                onChange={(e) => set('name', e.target.value)}
                aria-invalid={invalid('value.name')}
                required
              />
            )}
          </Row>
          <Row label="Domen">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.domain}
                onChange={(e) => set('domain', e.target.value)}
                aria-invalid={invalid('value.domain')}
                required
              />
            )}
          </Row>
          <Row label="Telefon" hint="Saytda va SMS'larda ko'rinadi">
            {(id) => (
              <input
                id={id}
                className={input}
                type="tel"
                value={v.phone}
                onChange={(e) => set('phone', e.target.value)}
                aria-invalid={invalid('value.phone')}
                required
              />
            )}
          </Row>
          <Row label="Email">
            {(id) => (
              <input
                id={id}
                className={input}
                type="email"
                value={v.email}
                onChange={(e) => set('email', e.target.value)}
                aria-invalid={invalid('value.email')}
                required
              />
            )}
          </Row>
          <Row label="Ish vaqti (UZ)">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.hours.uz}
                onChange={(e) => set('hours', { ...v.hours, uz: e.target.value })}
                required
              />
            )}
          </Row>
          <Row label="Ish vaqti (RU)">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.hours.ru}
                onChange={(e) => set('hours', { ...v.hours, ru: e.target.value })}
                required
              />
            )}
          </Row>
          <Row label="Telegram bot" hint="Saytdagi havola uchun (@ belgisisiz)">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.telegramBot}
                onChange={(e) => set('telegramBot', e.target.value)}
                aria-invalid={invalid('value.telegramBot')}
                required
              />
            )}
          </Row>
          <Row label="Instagram (ixtiyoriy)">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.instagram ?? ''}
                onChange={(e) => set('instagram', e.target.value || null)}
              />
            )}
          </Row>
          <Row label="Ma'lumotlar joylashuvi">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.dataLocation}
                onChange={(e) => set('dataLocation', e.target.value)}
                required
              />
            )}
          </Row>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-xs font-semibold">Tillar</legend>
            <span className="flex gap-4">
              {(['uz', 'ru'] as const).map((l) => (
                <label key={l} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-forest"
                    checked={v.languages.includes(l)}
                    onChange={(e) =>
                      set(
                        'languages',
                        e.target.checked ? [...v.languages, l] : v.languages.filter((x) => x !== l),
                      )
                    }
                  />
                  {l === 'uz' ? "O'zbekcha" : 'Русский'}
                </label>
              ))}
            </span>
          </fieldset>
          <Row label="Valyuta">
            {(id) => <input id={id} className={cn(input, 'bg-off')} value="UZS (so'm)" readOnly />}
          </Row>
        </div>
      </Panel>

      <Panel as="section" className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Yuridik ma&apos;lumotlar</h2>
          <Badge tone={doc.legalComplete ? 'good' : 'warn'} data-testid="legal-status">
            {doc.legalComplete
              ? "To'liq — huquqiy sahifalar e'lon qilingan"
              : 'Qoralama — huquqiy sahifalarda «qoralama» belgisi'}
          </Badge>
        </div>
        <p className="text-muted">
          Hamma maydon to&apos;ldirilganda oferta, maxfiylik va qaytarish sahifalaridagi «qoralama»
          belgisi olib tashlanadi. Bo&apos;sh maydon — hali to&apos;ldirilmagan.
          {legalFilled !== doc.legalComplete ? " Saqlangandan keyin holat o'zgaradi." : ''}
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(
            [
              ['entityName', 'Yuridik shaxs nomi', undefined],
              ['stir', 'STIR', '9 raqam'],
              ['address', 'Yuridik manzil', undefined],
              ['bank', 'Bank', undefined],
              ['mfo', 'MFO', '5 raqam'],
              ['account', 'Hisob raqam', '20 raqam'],
            ] as const
          ).map(([key, label, hint]) => (
            <Row key={key} label={label} hint={hint}>
              {(id) => (
                <input
                  id={id}
                  className={input}
                  value={v.legal[key] ?? ''}
                  onChange={(e) => setLegal(key, e.target.value)}
                  aria-invalid={invalid(`value.legal.${key}`)}
                />
              )}
            </Row>
          ))}
          <Row label="Oferta versiyasi" hint="Har buyurtmada saqlanadi; matn o'zgarganda yangilang">
            {(id) => (
              <input
                id={id}
                className={input}
                value={v.offerVersion}
                onChange={(e) => set('offerVersion', e.target.value)}
                aria-invalid={invalid('value.offerVersion')}
                required
              />
            )}
          </Row>
          <Row label="Ma'lumotni o'chirish muddati (kun)" hint="Qonun bo'yicha 30 kundan oshmasin">
            {(id) => (
              <input
                id={id}
                className={input}
                type="number"
                min={1}
                max={30}
                value={v.deletionSlaDays}
                onChange={(e) => set('deletionSlaDays', Number(e.target.value))}
                aria-invalid={invalid('value.deletionSlaDays')}
                required
              />
            )}
          </Row>
        </div>
      </Panel>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-md bg-panel/95 p-3 shadow-float">
        <Button type="submit" loading={busy}>
          Saqlash
        </Button>
        {saved ? (
          <span role="status" className="text-[13px] font-semibold text-good">
            Saqlandi
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <FormError message={error} />
        </div>
      </div>
    </form>
  );
}
