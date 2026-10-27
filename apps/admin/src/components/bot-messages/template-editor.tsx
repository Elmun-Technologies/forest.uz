'use client';

import type {
  AdminMessageTemplateDto,
  MessageTestResultDto,
  TemplateButton,
} from '@forest/contracts';
import {
  CUSTOM_TEMPLATE_KEY_RE,
  MARKETING_OPT_OUT,
  renderTemplate,
  templateExampleVars,
  templateMeta,
  templateProblems,
} from '@forest/contracts/core';
import { Badge, Button, cn, Field, Input, Panel, Switch, Textarea } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, errorText } from '../../lib/client-api';
import { compactInput, NumberInput } from '../products/fields';
import { COPY, KIND_LABEL, KIND_TONE, problemText } from './copy';

type Locale = 'uz' | 'ru';

interface Draft {
  key: string;
  body: { uz: string; ru: string };
  buttons: TemplateButton[];
  delayMin: number | null;
  smsFallback: boolean;
  smsApproved: boolean;
  active: boolean;
}

const draftOf = (t: AdminMessageTemplateDto | null): Draft => ({
  key: t?.key ?? 'custom_',
  body: t?.body ?? { uz: '', ru: '' },
  buttons: t?.buttons ?? [],
  delayMin: t?.delayMin ?? 0,
  smsFallback: t?.smsFallback ?? false,
  smsApproved: t?.smsApproved ?? false,
  active: t?.active ?? true,
});

/**
 * A12 template editor (design Admin-Bot "Shablon"): UZ/RU text with the key's variables, live
 * Telegram bubble + buttons (+ the opt-out the engine adds to marketing), SMS preview, delay, SMS
 * fallback, Eskiz approval, test to myself. Validation = the API's own `templateProblems`.
 */
export function TemplateEditor({ template }: { template: AdminMessageTemplateDto | null }) {
  const router = useRouter();
  const [initial, setInitial] = useState(() => draftOf(template));
  const [d, setD] = useState(initial);
  const [locale, setLocale] = useState<Locale>('uz');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const meta = templateMeta(d.key);
  const kind = meta?.kind ?? 'marketing';
  const channels = meta?.channels ?? ['TELEGRAM', 'SMS'];
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const problems = useMemo(
    () => templateProblems({ key: d.key, body: d.body, buttons: d.buttons }),
    [d.key, d.body, d.buttons],
  );
  const keyOk = template !== null || CUSTOM_TEMPLATE_KEY_RE.test(d.key);
  const example = templateExampleVars(d.key, locale);
  const rendered = renderTemplate(d.body[locale], example);

  /** Editing the text invalidates the Eskiz approval of the saved text. */
  function setBody(l: Locale, text: string) {
    setD((x) => {
      const body = { ...x.body, [l]: text };
      const same = body.uz === initial.body.uz && body.ru === initial.body.ru;
      return { ...x, body, smsApproved: same ? initial.smsApproved : false };
    });
  }

  function insert(v: string) {
    const el = area.current;
    const text = d.body[locale];
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    setBody(locale, `${text.slice(0, at)}{${v}}${text.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length + 2, at + v.length + 2);
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);
    const body = {
      body: d.body,
      buttons: d.buttons,
      delayMin: d.delayMin ?? 0,
      smsFallback: d.smsFallback,
      smsApproved: d.smsApproved,
      active: d.active,
    };
    try {
      if (template)
        await adminFetch(`/admin/messaging/templates/${encodeURIComponent(template.key)}`, {
          method: 'PATCH',
          body,
        });
      else
        await adminFetch('/admin/messaging/templates', {
          method: 'POST',
          body: { key: d.key, ...body },
        });
      setInitial(d);
      setNotice(COPY.saved);
      if (!template) router.push(`/bot/messages?key=${encodeURIComponent(d.key)}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!template?.custom || !window.confirm(COPY.deleteConfirm)) return;
    setBusy('delete');
    setError(null);
    try {
      await adminFetch(`/admin/messaging/templates/${encodeURIComponent(template.key)}`, {
        method: 'DELETE',
      });
      router.push('/bot/messages');
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  }

  async function test() {
    if (!template) return;
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const r = await adminFetch<MessageTestResultDto>(
        `/admin/messaging/templates/${encodeURIComponent(template.key)}/test`,
        { method: 'POST', body: { locale } },
      );
      setNotice(COPY.testSent(r.to));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const buttonRows = d.buttons.map((b) => b.text[locale]).filter(Boolean);
  const showSms = channels.includes('SMS');
  const smsText =
    rendered === null
      ? null
      : kind === 'marketing'
        ? `${rendered}\n${MARKETING_OPT_OUT.smsLine[locale].replace('{url}', 'forest.uz/…/obuna/…')}`
        : rendered;

  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px] xl:sticky xl:top-4"
      aria-label="Shablon muharriri"
      data-testid="template-editor"
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{template ? template.key : COPY.newTemplate}</span>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{template?.label ?? COPY.newTemplate}</h2>
            <Badge tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Badge>
            {channels.map((c) => (
              <Badge key={c} tone="light" className="border border-line">
                {c === 'TELEGRAM' ? 'Telegram' : 'SMS'}
              </Badge>
            ))}
          </div>
        </div>
        <FormError message={error} />
        {notice ? (
          <p role="status" className="rounded-sm bg-good-bg px-3 py-2 font-semibold text-good">
            {notice}
          </p>
        ) : null}

        {template ? null : (
          <Field label={COPY.key} hint={COPY.keyHint}>
            {(p) => (
              <Input
                {...p}
                className={cn(compactInput, 'font-mono')}
                required
                value={d.key}
                onChange={(e) => set('key', e.target.value.toLowerCase())}
                aria-invalid={!keyOk}
                data-testid="template-key"
              />
            )}
          </Field>
        )}

        <div className="flex items-center justify-between gap-2">
          <b className="font-semibold">
            {COPY.body} · {locale.toUpperCase()}
          </b>
          <div className="flex gap-1 rounded-pill bg-canvas p-1" role="group" aria-label="Til">
            {(['uz', 'ru'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => setLocale(l)}
                className={cn(
                  'rounded-pill px-3 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-forest',
                  locale === l ? 'bg-ink text-white' : 'text-muted',
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          ref={area}
          aria-label={`${COPY.body} ${locale.toUpperCase()}`}
          rows={4}
          maxLength={1000}
          value={d.body[locale]}
          onChange={(e) => setBody(locale, e.target.value)}
          className="min-h-24 text-sm"
          data-testid={`template-body-${locale}`}
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5" aria-label={COPY.variables}>
            {(meta?.vars ?? []).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                className="rounded-sm border border-line bg-off px-2 py-1 font-mono text-xs hover:bg-sage focus-visible:outline-2 focus-visible:outline-forest"
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">{COPY.variablesHint}</span>
        </div>
        {problems.length ? (
          <ul
            className="flex flex-col gap-0.5 text-xs font-semibold text-danger"
            data-testid="template-problems"
          >
            {problems.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
        ) : null}

        {channels.includes('TELEGRAM') ? (
          <div className="flex flex-col gap-2 rounded-md bg-sage-50 p-3">
            <span className="text-xs text-muted">
              {COPY.preview} · {COPY.previewNote}
            </span>
            <p
              className="rounded-md bg-white px-3.5 py-3 text-sm whitespace-pre-wrap"
              data-testid="template-preview"
            >
              {rendered ?? '—'}
            </p>
            {buttonRows.map((b, i) => (
              <span
                key={i}
                className="self-start rounded-sm bg-white px-3 py-2 text-xs font-semibold text-telegram"
              >
                {b}
              </span>
            ))}
            {kind === 'marketing' ? (
              <span className="self-start rounded-sm bg-white px-3 py-2 text-xs font-semibold text-telegram">
                {MARKETING_OPT_OUT.telegramButton[locale]}
              </span>
            ) : null}
          </div>
        ) : null}
        {showSms ? (
          <div className="flex flex-col gap-1 rounded-md bg-off p-3">
            <span className="text-xs text-muted">{COPY.smsPreview}</span>
            <p className="font-mono text-xs whitespace-pre-wrap">{smsText ?? '—'}</p>
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 font-semibold">{COPY.buttons}</legend>
          {d.buttons.map((b, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-md border border-line-soft p-2 sm:grid-cols-2"
            >
              <Field label={`${COPY.buttonText} · ${locale.toUpperCase()}`}>
                {(p) => (
                  <Input
                    {...p}
                    className={compactInput}
                    maxLength={40}
                    value={b.text[locale]}
                    onChange={(e) =>
                      set(
                        'buttons',
                        d.buttons.map((x, j) =>
                          j === i ? { ...x, text: { ...x.text, [locale]: e.target.value } } : x,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={COPY.buttonUrl} hint={COPY.buttonUrlHint}>
                {(p) => (
                  <Input
                    {...p}
                    className={cn(compactInput, 'font-mono')}
                    value={b.url}
                    onChange={(e) =>
                      set(
                        'buttons',
                        d.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                      )
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                className="justify-self-start text-xs font-semibold text-danger underline"
                onClick={() =>
                  set(
                    'buttons',
                    d.buttons.filter((_, j) => j !== i),
                  )
                }
              >
                {COPY.removeButton}
              </button>
            </div>
          ))}
          {d.buttons.length < 2 ? (
            <button
              type="button"
              className="self-start text-xs font-semibold underline"
              onClick={() =>
                set('buttons', [...d.buttons, { text: { uz: '', ru: '' }, url: '{link}' }])
              }
            >
              {COPY.addButton}
            </button>
          ) : null}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={COPY.delay} hint={COPY.delayHint}>
            {(p) => (
              <NumberInput
                {...p}
                min={0}
                value={d.delayMin}
                onChange={(v) => set('delayMin', v)}
                data-testid="template-delay"
              />
            )}
          </Field>
          <div className="flex flex-col gap-3 pt-6">
            <label className="flex items-center gap-2">
              <Switch
                checked={d.active}
                onCheckedChange={(v) => set('active', v)}
                aria-label={COPY.active}
              />
              {COPY.active}
            </label>
            {channels.includes('TELEGRAM') && channels.includes('SMS') ? (
              <label className="flex items-center gap-2">
                <Switch
                  checked={d.smsFallback}
                  onCheckedChange={(v) => set('smsFallback', v)}
                  aria-label={COPY.smsFallback}
                />
                {COPY.smsFallback}
              </label>
            ) : null}
          </div>
        </div>
        {showSms ? (
          <label className="flex items-start gap-2 rounded-md bg-warn-bg p-3 text-warn">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-forest"
              checked={d.smsApproved}
              onChange={(e) => set('smsApproved', e.target.checked)}
              aria-label={COPY.smsApproved}
              data-testid="template-approved"
            />
            <span className="flex flex-col gap-0.5">
              <b className="font-semibold">{COPY.smsApproved}</b>
              <span className="text-xs">{COPY.smsApprovedHint}</span>
            </span>
          </label>
        ) : null}
        {kind === 'marketing' ? <p className="text-xs text-muted">{COPY.marketingNote}</p> : null}

        {template ? (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-line-soft p-3 text-center">
            <span className="flex flex-col">
              <b className="tabular text-base">{template.stats.sent}</b>
              <span className="text-xs text-muted">{COPY.sent}</span>
            </span>
            <span className="flex flex-col">
              <b className="tabular text-base">{template.stats.skipped}</b>
              <span className="text-xs text-muted">{COPY.skipped}</span>
            </span>
            <span className="flex flex-col">
              <b className="tabular text-base">{template.stats.failed}</b>
              <span className="text-xs text-muted">{COPY.failed}</span>
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            block
            disabled={!template || dirty}
            title={dirty ? COPY.testDirty : COPY.testHint}
            loading={busy === 'test'}
            onClick={() => void test()}
            data-testid="template-test"
          >
            {COPY.test}
          </Button>
          <Button
            type="submit"
            block
            loading={busy === 'save'}
            disabled={problems.length > 0 || !keyOk || !dirty}
            data-testid="template-save"
          >
            {COPY.save}
          </Button>
        </div>
        <p className="text-xs text-muted">{dirty ? COPY.testDirty : COPY.testHint}</p>
        {template?.custom ? (
          <Button
            type="button"
            variant="ghost"
            loading={busy === 'delete'}
            onClick={() => void remove()}
            className="self-start text-danger"
            data-testid="template-delete"
          >
            {COPY.delete}
          </Button>
        ) : null}
      </form>
    </Panel>
  );
}
