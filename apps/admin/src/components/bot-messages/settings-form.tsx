'use client';

import type { MessagingSettingsDto } from '@forest/contracts';
import { Button, cn, Field, Input, Panel, Switch } from '@forest/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, errorText } from '../../lib/client-api';
import { compactInput, NumberInput } from '../products/fields';
import { COPY, DAY_LABELS } from './copy';

type Value = MessagingSettingsDto['value'];

/** A12 "Sozlamalar": cap, quiet hours, operator hours/operators, languages, automation switches. */
export function MessagingSettingsForm({
  settings,
  canManageBot,
}: {
  settings: MessagingSettingsDto;
  /** `integrations.view`: the bot token itself is edited in the integrations hub. */
  canManageBot: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<Value>(settings.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = <K extends keyof Value>(k: K, val: Value[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { abandonedCartMinutes: _c, reviewRequestDays: _r, ...rest } = v;
    try {
      await adminFetch('/admin/messaging/settings', {
        method: 'PUT',
        body: { ...rest, version: settings.version },
      });
      setNotice(COPY.settingsSaved);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const time = (k: 'quietStart' | 'quietEnd' | 'operatorStart' | 'operatorEnd', label: string) => (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          type="time"
          required
          className={compactInput}
          value={v[k]}
          onChange={(e) => set(k, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]"
      aria-labelledby="messaging-settings"
      data-testid="messaging-settings"
    >
      <h2 id="messaging-settings" className="text-xl font-semibold">
        {COPY.settings}
      </h2>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <FormError message={error} />
        {notice ? (
          <p role="status" className="rounded-sm bg-good-bg px-3 py-2 font-semibold text-good">
            {notice}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 font-semibold">{COPY.scenarios}</legend>
          {(['abandonedCart', 'reviewRequest', 'waitlist'] as const).map((s) => (
            <label
              key={s}
              className="flex items-center justify-between gap-2 border-b border-line-soft py-1.5"
            >
              {COPY[s]}
              <Switch
                checked={v.scenarios[s]}
                onCheckedChange={(on) => set('scenarios', { ...v.scenarios, [s]: on })}
                aria-label={COPY[s]}
                data-testid={`scenario-${s}`}
              />
            </label>
          ))}
          <span className="text-xs text-muted">
            {COPY.delays(v.abandonedCartMinutes, v.reviewRequestDays)}
          </span>
        </fieldset>

        <Field label={COPY.cap} hint={COPY.capHint}>
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              required
              value={v.marketingPerDay}
              onChange={(n) => set('marketingPerDay', n ?? 0)}
              data-testid="settings-cap"
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <b className="font-semibold">{COPY.quiet}</b>
          <div className="grid grid-cols-2 gap-2">
            {time('quietStart', 'Dan')}
            {time('quietEnd', 'Gacha')}
          </div>
          <span className="text-xs text-muted">{COPY.quietHint}</span>
        </div>

        <div className="flex flex-col gap-1">
          <b className="font-semibold">{COPY.hours}</b>
          <div className="flex flex-wrap gap-1" role="group" aria-label={COPY.days}>
            {DAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                aria-pressed={v.operatorDays.includes(day)}
                onClick={() => set('operatorDays', toggle(v.operatorDays, day).sort())}
                className={cn(
                  'h-8 min-w-10 rounded-sm px-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-forest',
                  v.operatorDays.includes(day) ? 'bg-ink text-white' : 'bg-canvas',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {time('operatorStart', 'Dan')}
            {time('operatorEnd', 'Gacha')}
          </div>
          <Link
            href="/bot/messages?key=advice_off_hours"
            prefetch={false}
            className="text-xs font-semibold underline"
          >
            {COPY.offHours}: {COPY.offHoursEdit}
          </Link>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 font-semibold">{COPY.operators}</legend>
          {settings.operatorOptions.length === 0 ? (
            <span className="text-muted">{COPY.operatorsEmpty}</span>
          ) : (
            settings.operatorOptions.map((o) => (
              <label key={o.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-forest"
                  checked={v.operatorIds.includes(o.id)}
                  onChange={() => set('operatorIds', toggle(v.operatorIds, o.id))}
                />
                {o.name}
              </label>
            ))
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 font-semibold">{COPY.languages}</legend>
          <div className="flex gap-3">
            {(['uz', 'ru'] as const).map((l) => (
              <label key={l} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-forest"
                  checked={v.languages.includes(l)}
                  onChange={() => set('languages', toggle(v.languages, l))}
                />
                {l.toUpperCase()}
              </label>
            ))}
          </div>
          <span className="text-xs text-muted">{COPY.languagesHint}</span>
        </fieldset>

        <div className="flex items-center justify-between gap-2 rounded-md bg-off p-3">
          <span className="flex flex-col">
            <b className="font-semibold">{COPY.botToken}</b>
            <span className="font-mono text-xs text-muted">
              {settings.bot.tokenMasked
                ? `${settings.bot.username ? `@${settings.bot.username} · ` : ''}${settings.bot.tokenMasked}`
                : COPY.botNotConnected}
            </span>
          </span>
          {canManageBot ? (
            <Link href="/integrations" prefetch={false} className="text-xs font-semibold underline">
              {COPY.botManage}
            </Link>
          ) : null}
        </div>

        <Button type="submit" block loading={busy} data-testid="settings-save">
          {COPY.save}
        </Button>
      </form>
    </Panel>
  );
}
