'use client';

import {
  type AdminSeoPageDto,
  type AiSeoDraftDto,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
  SEO_TITLE_MIN,
  serpCut,
} from '@forest/contracts/core';
import { Button, cn, Panel, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { soum } from '../products/format';
import { COPY, KIND_LABEL, RULE_LABEL } from './copy';

type Locale = 'uz' | 'ru';

const input =
  'h-11 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none';

const draftOf = (p: AdminSeoPageDto) => ({
  title: p.override?.title ?? '',
  description: p.override?.description ?? '',
  noindex: p.override?.noindex ?? false,
  canonical: p.override?.canonical ?? '',
  ogImageId: p.override?.ogImageId ?? null,
});

/** A9 "Sahifa meta teglari": per page × locale override with SERP + rich preview and checks. */
export function SeoMetaEditor({
  pages: initial,
  siteUrl,
}: {
  pages: AdminSeoPageDto[];
  siteUrl: string;
}) {
  const router = useRouter();
  const [pages, setPages] = useState(initial);
  const [locale, setLocale] = useState<Locale>('uz');
  const [path, setPath] = useState(initial[0]?.path ?? '/');
  const page =
    pages.find((p) => p.path === path && p.locale === locale) ??
    pages.find((p) => p.locale === locale)!;
  const [draft, setDraft] = useState(() => draftOf(page));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const select = (nextPath: string, nextLocale: Locale) => {
    const next = pages.find((p) => p.path === nextPath && p.locale === nextLocale);
    if (!next) return;
    setPath(nextPath);
    setLocale(nextLocale);
    setDraft(draftOf(next));
    setMsg(null);
  };

  const groups = useMemo(() => {
    const out = new Map<string, AdminSeoPageDto[]>();
    for (const p of pages.filter((x) => x.locale === locale))
      out.set(KIND_LABEL[p.kind], [...(out.get(KIND_LABEL[p.kind]) ?? []), p]);
    return [...out];
  }, [pages, locale]);

  const title = draft.title.trim() || page.template.title;
  const description = draft.description.trim() || page.template.description;
  const host = siteUrl.replace(/^https?:\/\//, '');
  const crumbs = [host, locale, ...page.path.split('/').filter(Boolean)].join(' › ');

  async function save(body: typeof draft) {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await adminFetch<AdminSeoPageDto>('/admin/seo/meta', {
        method: 'PUT',
        body: {
          path: page.path,
          locale,
          title: body.title.trim(),
          description: body.description.trim(),
          noindex: body.noindex,
          canonical: body.canonical.trim() || null,
          ogImageId: body.ogImageId,
        },
      });
      setPages((list) =>
        list.map((p) => (p.path === updated.path && p.locale === updated.locale ? updated : p)),
      );
      setDraft(draftOf(updated));
      setMsg({ ok: true, text: COPY.saved });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const [aiBusy, setAiBusy] = useState(false);

  /** "AI bilan taklif" (Phase 5, CLAUDE.md §6): fills this locale's fields; saving stays manual. */
  async function aiSuggest() {
    setAiBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch<AiSeoDraftDto>('/admin/ai/seo', {
        method: 'POST',
        body: { path: page.path },
      });
      setDraft((d) => ({ ...d, title: r[locale].title, description: r[locale].description }));
      setMsg({ ok: true, text: r.fake ? COPY.aiFake : COPY.aiReady });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setAiBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(draft);
  }

  const checks = [
    {
      ok: title.length >= SEO_TITLE_MIN && title.length <= SEO_TITLE_MAX,
      title: 'Title uzunligi',
      hint: `${title.length} belgi · ${SEO_TITLE_MIN}–${SEO_TITLE_MAX} oralig'ida`,
    },
    {
      ok: description.length >= SEO_DESCRIPTION_MIN && description.length <= SEO_DESCRIPTION_MAX,
      title: 'Description',
      hint: `${description.length} belgi · ${SEO_DESCRIPTION_MIN}–${SEO_DESCRIPTION_MAX}`,
    },
    ...(page.kind === 'product'
      ? [
          {
            ok: page.imagesWithoutAlt === 0,
            title: page.imagesWithoutAlt
              ? `${page.imagesWithoutAlt} ta rasmda alt yo'q`
              : 'Alt matnlar',
            hint: page.imagesWithoutAlt ? 'Mahsulotlar → Rasmlar' : 'Hamma rasmda bor',
          },
          {
            ok: true,
            title: 'Product schema',
            hint: page.rich?.rating
              ? 'Narx, qoldiq va reyting bor'
              : "Narx va qoldiq bor; reyting — tasdiqlangan sharhlar bo'lganda",
          },
        ]
      : []),
    { ok: true, title: 'hreflang uz/ru', hint: "To'g'ri (x-default = uz)" },
    {
      ok: !draft.noindex,
      title: draft.noindex ? 'Noindex yoqilgan' : 'Indekslanadi',
      hint: draft.noindex ? 'Sahifa sitemap va qidiruvdan chiqadi' : 'Sitemapda bor',
    },
  ];
  const serverIssues = page.issues.filter(
    (i) =>
      !['title_length', 'description_length', 'alt_missing', 'noindex_in_sitemap'].includes(i.rule),
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Panel
        as="section"
        className="flex flex-col gap-4 p-5 sm:p-7"
        aria-labelledby="seo-meta-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="seo-meta-title" className="text-xl font-semibold">
            {COPY.metaTitle}
          </h2>
          <div className="flex gap-1 rounded-pill bg-canvas p-1" role="group" aria-label="Til">
            {(['uz', 'ru'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => select(page.path, l)}
                className={cn(
                  'rounded-pill px-4 py-1.5 text-[13px] font-semibold',
                  locale === l ? 'bg-ink text-white' : 'text-muted',
                )}
              >
                {l === 'uz' ? "O'zbekcha" : 'Русский'}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-semibold">
          Sahifa
          <select
            className={input}
            value={page.path}
            onChange={(e) => select(e.target.value, locale)}
            data-testid="seo-page-select"
          >
            {groups.map(([label, list]) => (
              <optgroup key={label} label={label}>
                {list.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label} {p.issues.some((i) => i.severity === 'critical') ? '●' : ''} ({p.path}
                    )
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <form onSubmit={submit} className="flex flex-col gap-4" aria-label={COPY.metaTitle}>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            <span className="flex justify-between">
              Title
              <span className={draft.title.length > SEO_TITLE_MAX ? 'text-critical' : 'text-good'}>
                {draft.title.length} / {SEO_TITLE_MAX}
              </span>
            </span>
            <input
              className={input}
              value={draft.title}
              maxLength={SEO_TITLE_MAX}
              placeholder={page.template.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              data-testid="seo-title"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            <span className="flex justify-between">
              Description
              <span className="text-good">
                {draft.description.length} / {SEO_DESCRIPTION_MAX}
              </span>
            </span>
            <textarea
              className="min-h-24 w-full rounded-sm border border-line bg-panel p-3 text-sm focus:border-ink focus:outline-none"
              value={draft.description}
              maxLength={SEO_DESCRIPTION_MAX}
              placeholder={page.template.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <p className="text-[11px] text-muted">{COPY.templateHint}</p>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="flex flex-col gap-1.5 text-xs font-semibold">
              URL
              <code className="flex h-11 items-center truncate rounded-sm border border-line px-3 font-mono text-xs font-normal text-muted">
                {page.url.replace(/^https?:\/\//, '')}
              </code>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              Canonical (bo&apos;sh = avtomatik · uz ↔ ru)
              <input
                className={input}
                value={draft.canonical}
                placeholder="Avtomatik"
                onChange={(e) => setDraft({ ...draft, canonical: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              Indekslash
              <span className="flex h-11 items-center gap-2 font-normal">
                <Switch
                  checked={!draft.noindex}
                  onCheckedChange={(v) => setDraft({ ...draft, noindex: !v })}
                  aria-label="Indekslash"
                />
                {draft.noindex ? 'noindex, follow' : 'index, follow'}
              </span>
            </label>
          </div>

          {page.images.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-semibold">OG rasm (ulashishda)</legend>
              <div className="flex flex-wrap gap-2">
                {[{ fileId: null, url: null }, ...page.images].map((img) => (
                  <button
                    key={img.fileId ?? 'auto'}
                    type="button"
                    aria-pressed={draft.ogImageId === img.fileId}
                    onClick={() => setDraft({ ...draft, ogImageId: img.fileId })}
                    className={cn(
                      'grid size-16 place-items-center overflow-hidden rounded-sm border text-[11px]',
                      draft.ogImageId === img.fileId ? 'border-ink ring-2 ring-ink' : 'border-line',
                    )}
                  >
                    {img.url ? (
                      <img src={img.url} alt="" className="size-full object-cover" />
                    ) : (
                      'Avto'
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <figure
            className="flex flex-col gap-1 rounded-md bg-off p-5"
            aria-label={COPY.serp}
            data-testid="seo-serp"
          >
            <figcaption className="pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {COPY.serp}
            </figcaption>
            <span className="text-xs text-muted">{crumbs}</span>
            <span className="text-[19px] leading-snug text-[#1a0dab]">
              {serpCut(title, SEO_TITLE_MAX + 2)}
            </span>
            <span className="text-[13px] leading-relaxed text-ink-2">
              {serpCut(description, SEO_DESCRIPTION_MAX)}
            </span>
            {page.rich ? (
              <span className="pt-1 text-xs text-muted">
                {page.rich.rating
                  ? `★★★★★ Reyting: ${String(page.rich.rating.average).replace('.', ',')} · ${page.rich.rating.count} sharh · `
                  : ''}
                {soum(page.rich.priceFromSoum)} so&apos;m ·{' '}
                {page.rich.inStock ? 'Omborda bor' : "Omborda yo'q"}
              </span>
            ) : null}
          </figure>

          {msg ? (
            <p role="status" className={cn('text-sm', msg.ok ? 'text-good' : 'text-critical')}>
              {msg.text}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {page.override ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void save({
                    title: '',
                    description: '',
                    noindex: false,
                    canonical: '',
                    ogImageId: null,
                  })
                }
              >
                {COPY.reset}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              loading={aiBusy}
              onClick={() => void aiSuggest()}
              data-testid="seo-ai"
            >
              {COPY.aiSuggest}
            </Button>
            <Button type="submit" loading={busy} data-testid="seo-save">
              {COPY.save}
            </Button>
          </div>
          <p className="text-right text-[11px] text-muted">{COPY.aiHint}</p>
        </form>
      </Panel>

      <Panel as="aside" className="flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="seo-check">
        <h2 id="seo-check" className="text-xl font-semibold">
          {COPY.check}
        </h2>
        <ul className="flex flex-col gap-3">
          {checks.map((c) => (
            <li key={c.title} className="flex gap-3">
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-pill text-xs font-bold',
                  c.ok ? 'bg-good-bg text-good' : 'bg-warn-bg text-warn',
                )}
              >
                {c.ok ? '✓' : '!'}
              </span>
              <span className="flex flex-col">
                <b className="text-sm font-semibold">{c.title}</b>
                <span className="text-xs text-muted">{c.hint}</span>
              </span>
            </li>
          ))}
          {serverIssues.map((i) => (
            <li key={i.rule} className="flex gap-3">
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-pill text-xs font-bold',
                  i.severity === 'critical'
                    ? 'bg-critical-bg text-critical'
                    : 'bg-warn-bg text-warn',
                )}
              >
                !
              </span>
              <span className="flex flex-col">
                <b className="text-sm font-semibold">{RULE_LABEL[i.rule].title}</b>
                <span className="text-xs text-muted">{RULE_LABEL[i.rule].hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
