'use client';

import type { AddressDto } from '@forest/contracts';
import { TASHKENT_DISTRICTS, UZ_REGIONS } from '@forest/contracts/core';
import { Badge, Button, cn, Field, Input, inputClasses } from '@forest/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { ClientApiError, clientApi, type AddressInput } from '@/lib/client-api';
import { placeName } from '@/lib/format';

/** Saved addresses: list, add, edit, delete, make default (GET/POST/PATCH/DELETE /me/addresses). */
export function AddressBook({
  initial,
  compact = false,
}: {
  initial: AddressDto[];
  compact?: boolean;
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const locale = useLocale() as 'uz' | 'ru';
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const fail = (e: unknown) =>
    toast(
      e instanceof ClientApiError && e.code === 'NETWORK'
        ? tc('network')
        : e instanceof ClientApiError && e.status < 500
          ? e.message
          : tc('generic'),
      'critical',
    );

  async function reload() {
    setItems(await clientApi.me.addresses());
  }

  async function save(id: string | 'new', input: AddressInput) {
    try {
      if (id === 'new') await clientApi.me.addAddress(input);
      else await clientApi.me.updateAddress(id, input);
      await reload();
      setEditing(null);
      toast(t('saved'), 'good');
    } catch (e) {
      fail(e);
    }
  }

  async function remove(id: string) {
    try {
      await clientApi.me.deleteAddress(id);
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  const shown = compact ? items.slice(0, 2) : items;
  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {items.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-muted">{t('noAddresses')}</p>
      ) : null}
      <ul className="flex flex-col gap-3 lg:gap-4">
        {shown.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AddressForm
                initial={a}
                onCancel={() => setEditing(null)}
                onSave={(v) => save(a.id, v)}
              />
            </li>
          ) : (
            <li
              key={a.id}
              className={cn(
                'flex flex-col gap-1.5 rounded-[24px] p-5',
                a.isDefault ? 'border-2 border-ink' : 'border border-line',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <b data-private>{a.label ?? placeName(a, locale)}</b>
                {a.isDefault ? <Badge tone="dark">{t('default')}</Badge> : null}
              </span>
              <span className="text-sm text-muted" data-private>
                {placeName(a, locale)}, {a.line}
              </span>
              {compact ? null : (
                <span className="mt-1 flex flex-wrap gap-3 text-[13px]">
                  <button
                    type="button"
                    className="min-h-9 underline"
                    onClick={() => setEditing(a.id)}
                  >
                    {t('edit')}
                  </button>
                  {a.isDefault ? null : (
                    <button
                      type="button"
                      className="min-h-9 underline"
                      onClick={() => void save(a.id, { ...a, isDefault: true })}
                    >
                      {t('makeDefault')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="min-h-9 text-danger underline"
                    aria-label={t('deleteLabel', { label: a.label ?? a.line })}
                    onClick={() => void remove(a.id)}
                  >
                    {t('delete')}
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <AddressForm onCancel={() => setEditing(null)} onSave={(v) => save('new', v)} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          data-testid="address-new"
          className="min-h-14 rounded-[24px] border-[1.5px] border-dashed border-[#B9BEB2] p-[18px] text-sm font-medium hover:border-ink"
        >
          + {t('newAddress')}
        </button>
      )}
    </div>
  );
}

function AddressForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AddressDto;
  onSave: (v: AddressInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('account');
  const locale = useLocale() as 'uz' | 'ru';
  const [label, setLabel] = useState(initial?.label ?? '');
  const [region, setRegion] = useState(initial?.region ?? 'tashkent_city');
  const [district, setDistrict] = useState(initial?.district ?? '');
  const [line, setLine] = useState(initial?.line ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave({
      label: label.trim() || null,
      region,
      district: district || null,
      line: line.trim(),
      isDefault,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[24px] border border-line p-5">
      <Field label={t('label')}>
        {(p) => (
          <Input
            {...p}
            value={label}
            maxLength={40}
            data-private
            placeholder={t('labelPlaceholder')}
            onChange={(e) => setLabel(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('region')}>
        {(p) => (
          <select
            {...p}
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setDistrict('');
            }}
            className={cn(inputClasses, 'appearance-auto')}
          >
            {UZ_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r[locale]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('district')}>
        {(p) =>
          region === 'tashkent_city' ? (
            <select
              {...p}
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className={cn(inputClasses, 'appearance-auto')}
            >
              <option value="" />
              {TASHKENT_DISTRICTS.map((d) => (
                <option key={d.code} value={d.code}>
                  {d[locale]}
                </option>
              ))}
            </select>
          ) : (
            <Input
              {...p}
              value={district}
              maxLength={80}
              data-private
              onChange={(e) => setDistrict(e.target.value)}
            />
          )
        }
      </Field>
      <Field label={t('line')}>
        {(p) => (
          <Input
            {...p}
            required
            minLength={5}
            maxLength={300}
            autoComplete="street-address"
            placeholder={t('linePlaceholder')}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            data-private
          />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="size-5 accent-forest"
        />
        {t('makeDefault')}
      </label>
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={line.trim().length < 5}>
          {t('save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
