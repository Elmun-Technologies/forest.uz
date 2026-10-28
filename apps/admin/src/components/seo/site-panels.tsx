'use client';

import type { AdminSeoOverviewDto, SeoSchemaKey, SeoSchemaToggles } from '@forest/contracts/core';
import { SEO_SCHEMA_KEYS } from '@forest/contracts/core';
import { Button, cn, Panel, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { COPY, SCHEMA_LABEL } from './copy';

const input =
  'h-11 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none';

const when = (iso: string | null) => (iso ? formatWhen(iso) : '—');

/** Runs one admin mutation with a busy flag and an inline message, then refreshes the page. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }
  const message = msg ? (
    <p role="status" className={cn('text-xs', msg.ok ? 'text-good' : 'text-critical')}>
      {msg.text}
    </p>
  ) : null;
  return { busy, run, message };
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 text-[13px] last:border-0">
      <span>{label}</span>
      <span className="flex items-center gap-2 font-semibold">{children}</span>
    </div>
  );
}

/** "Texnik": sitemap, robots.txt, redirects, 404, IndexNow. */
export function TechnicalPanel({ o }: { o: AdminSeoOverviewDto }) {
  const { busy, run, message } = useAction();
  const [robotsOpen, setRobotsOpen] = useState(false);
  const [robots, setRobots] = useState(o.robots.custom ?? o.robots.defaultText);

  return (
    <Panel as="section" className="flex flex-col p-5 sm:p-6" aria-labelledby="seo-tech">
      <h2 id="seo-tech" className="pb-2 text-xl font-semibold">
        {COPY.technical}
      </h2>
      <Row
        label={
          <a
            href={o.sitemap.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            sitemap.xml · {o.sitemap.urls} URL
          </a>
        }
      >
        <span className="text-forest">Avtomatik · {when(o.sitemap.generatedAt)}</span>
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'sitemap'}
          onClick={() =>
            void run(
              'sitemap',
              () => adminFetch('/admin/seo/sitemap/regenerate', { method: 'POST' }),
              'Sitemap qayta yaratildi.',
            )
          }
          data-testid="seo-sitemap-regenerate"
        >
          Yangilash
        </Button>
      </Row>
      <Row label="robots.txt">
        <span className="text-muted">{o.robots.custom ? 'Qo‘lda' : 'Avtomatik'}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRobotsOpen((v) => !v)}
          aria-expanded={robotsOpen}
        >
          Tahrirlash
        </Button>
      </Row>
      {robotsOpen ? (
        <form
          className="flex flex-col gap-2 py-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const custom = robots.trim() === o.robots.defaultText.trim() ? null : robots;
            void run(
              'robots',
              () => adminFetch('/admin/seo/robots', { method: 'PUT', body: { custom } }),
              'robots.txt saqlandi.',
            );
          }}
        >
          <textarea
            className="min-h-48 rounded-sm border border-line bg-panel p-3 font-mono text-xs"
            value={robots}
            onChange={(e) => setRobots(e.target.value)}
            aria-label="robots.txt"
            data-testid="seo-robots"
          />
          <p className="text-[11px] text-muted">{COPY.robotsHint}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRobots(o.robots.defaultText)}
            >
              Avtomatikka qaytarish
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={busy === 'robots'}
              data-testid="seo-robots-save"
            >
              Saqlash
            </Button>
          </div>
        </form>
      ) : null}
      <Row label={COPY.redirects}>
        <a href="#redirects" className="hover:underline">
          {o.redirects} ta · qo&apos;shish
        </a>
      </Row>
      <Row label={`${COPY.notFound} (7 kun)`}>
        <a
          href="#not-found"
          className={cn('hover:underline', o.notFound7d.paths > 0 && 'text-critical')}
        >
          {o.notFound7d.paths} ta
        </a>
      </Row>
      <Row label="IndexNow (Yandex, Bing)">
        <span className={o.indexNow.enabled ? 'text-forest' : 'text-muted'}>
          {o.indexNow.enabled ? 'Yoqilgan' : "O'chiq"}
        </span>
        <Switch
          checked={o.indexNow.enabled}
          disabled={busy === 'indexnow'}
          aria-label="IndexNow"
          onCheckedChange={(enabled) =>
            void run(
              'indexnow',
              () => adminFetch('/admin/seo/indexnow', { method: 'PUT', body: { enabled } }),
              enabled ? 'IndexNow yoqildi.' : "IndexNow o'chirildi.",
            )
          }
        />
      </Row>
      <div className="flex flex-col gap-1 pt-1 text-[11px] text-muted">
        <span>
          Kalit fayli:{' '}
          <a href={o.indexNow.keyFileUrl} target="_blank" rel="noreferrer" className="underline">
            {o.indexNow.keyFileUrl.replace(/^https?:\/\//, '')}
          </a>
          {o.indexNow.pending ? ` · navbatda ${o.indexNow.pending} URL` : ''}
        </span>
        {!o.indexNow.publicHost ? (
          <span>Sayt manzili ochiq https domen emas — pinglar yuborilmaydi (dev/staging).</span>
        ) : null}
        {o.indexNow.lastPing ? (
          <span>
            Oxirgi: {when(o.indexNow.lastPing.at)} · {o.indexNow.lastPing.ok ? 'OK' : 'xato'} ·{' '}
            {o.indexNow.lastPing.message}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="self-start px-0"
          loading={busy === 'submit-all'}
          onClick={() =>
            void run(
              'submit-all',
              () => adminFetch('/admin/seo/indexnow/submit-all', { method: 'POST' }),
              "Barcha sahifalar navbatga qo'yildi (1 daqiqada yuboriladi).",
            )
          }
        >
          Barcha sahifalarni yuborish
        </Button>
      </div>
      {message}
    </Panel>
  );
}

/** "Schema.org shablonlari" toggles. */
export function SchemaPanel({ schema, faqPages }: { schema: SeoSchemaToggles; faqPages: number }) {
  const { busy, run, message } = useAction();
  const toggle = (key: SeoSchemaKey, value: boolean) =>
    void run(
      key,
      () => adminFetch('/admin/seo/schema', { method: 'PUT', body: { ...schema, [key]: value } }),
      'Saqlandi.',
    );
  return (
    <Panel as="section" className="flex flex-col p-5 sm:p-6" aria-labelledby="seo-schema">
      <h2 id="seo-schema" className="pb-2 text-xl font-semibold">
        {COPY.schema}
      </h2>
      {SEO_SCHEMA_KEYS.map((key) => (
        <Row key={key} label={SCHEMA_LABEL[key]}>
          <span className={schema[key] ? 'text-forest' : 'text-muted'}>
            {schema[key]
              ? key === 'faq' && faqPages === 0
                ? "Faol · FAQ yo'q"
                : 'Faol'
              : "O'chiq"}
          </span>
          <Switch
            checked={schema[key]}
            disabled={busy !== null}
            aria-label={SCHEMA_LABEL[key]}
            onCheckedChange={(v) => toggle(key, v)}
          />
        </Row>
      ))}
      <p className="pt-2 text-[11px] text-muted">
        Reyting faqat tasdiqlangan sharhlardan. LocalBusiness do&apos;kon manzili ochiq
        bo&apos;lganda qo&apos;shiladi (ochiq savol). HowTo/VideoObject uchun hali kontent
        yo&apos;q.
      </p>
      {message}
    </Panel>
  );
}

/** Google / Yandex / Bing verification meta codes (rendered in the storefront `<head>`). */
export function VerificationForm({ v }: { v: AdminSeoOverviewDto['verification'] }) {
  const { busy, run, message } = useAction();
  const [form, setForm] = useState({
    google: v.google ?? '',
    yandex: v.yandex ?? '',
    bing: v.bing ?? '',
  });
  const fields = [
    ['google', 'Google Search Console', 'google-site-verification'],
    ['yandex', 'Yandex Webmaster', 'yandex-verification'],
    ['bing', 'Bing Webmaster', 'msvalidate.01'],
  ] as const;
  return (
    <Panel as="section" className="flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="seo-verify">
      <h2 id="seo-verify" className="text-xl font-semibold">
        {COPY.verification}
      </h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            'verify',
            () =>
              adminFetch('/admin/seo/verification', {
                method: 'PUT',
                body: {
                  google: form.google || null,
                  yandex: form.yandex || null,
                  bing: form.bing || null,
                },
              }),
            'Saqlandi — kod saytning <head> qismida.',
          );
        }}
      >
        {fields.map(([key, label, meta]) => (
          <label key={key} className="flex flex-col gap-1.5 text-xs font-semibold">
            {label} <span className="font-mono font-normal text-muted">{meta}</span>
            <input
              className={input}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              data-testid={`seo-verify-${key}`}
            />
          </label>
        ))}
        <p className="text-[11px] text-muted">{COPY.verificationHint}</p>
        <Button
          type="submit"
          className="self-end"
          loading={busy === 'verify'}
          data-testid="seo-verify-save"
        >
          Saqlash
        </Button>
      </form>
      {message}
    </Panel>
  );
}

/** "Hozir sinxronlash" for Search Console / Yandex Webmaster (last 5 days). */
export function SyncQueriesButton() {
  const { busy, run, message } = useAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        loading={busy === 'sync'}
        onClick={() =>
          void run(
            'sync',
            () => adminFetch('/admin/seo/queries/sync', { method: 'POST' }),
            'Sinxronlandi.',
          )
        }
      >
        {COPY.sync}
      </Button>
      {message}
    </span>
  );
}
