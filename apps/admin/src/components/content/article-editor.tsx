'use client';

import {
  ARTICLE_CATEGORIES,
  type AdminArticleDto,
  type AdminUploadedImageDto,
  type ArticleCategory,
  CMS_LIMITS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from '@forest/contracts/core';
import { Button, cn, Field, Input, Panel, Switch, Textarea } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminFetch, adminUpload, errorText } from '../../lib/client-api';
import { FormError } from '../auth-card';
import { ConfirmDialog } from '../customers/confirm-dialog';
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  type Block,
  CATEGORY_LABEL,
  cleanBlocks,
  emptyBlock,
} from './copy';

type Locale = 'uz' | 'ru';

interface LocaleDraft {
  title: string;
  excerpt: string;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
  blocks: Block[];
}

interface Draft {
  slug: string;
  category: ArticleCategory | null;
  coverId: string | null;
  videoUrl: string;
  videoMinutes: number | null;
  readingMinutes: number | null;
  sort: number;
  relatedProductIds: string[];
  uz: LocaleDraft;
  ru: LocaleDraft;
}

const draftOf = (a: AdminArticleDto): Draft => {
  const l = (x: Locale): LocaleDraft => ({
    title: a.locales[x].title,
    excerpt: a.locales[x].excerpt,
    published: a.locales[x].published,
    seoTitle: a.locales[x].seoTitle,
    seoDescription: a.locales[x].seoDescription,
    blocks: a.locales[x].blocks as Block[],
  });
  return {
    slug: a.slug,
    category: a.category,
    coverId: a.cover?.fileId ?? null,
    videoUrl: a.videoUrl ?? '',
    videoMinutes: a.videoMinutes,
    readingMinutes: a.readingMinutes,
    sort: a.sort,
    relatedProductIds: a.relatedProductIds,
    uz: l('uz'),
    ru: l('ru'),
  };
};

const small = 'h-10 text-sm';
const selectClass =
  'h-10 w-full rounded-sm border border-line bg-panel px-3 text-sm focus:border-ink focus:outline-none';

export interface ProductOption {
  id: string;
  name: { uz: string; ru: string };
  status: string;
}

/**
 * Ilhom article / Brend story editor (CLAUDE.md §6): UZ and RU are separate versions (each
 * published on its own), structured blocks, cover, related products and per-locale SEO. One save
 * writes the whole document.
 */
export function ArticleEditor({
  article,
  mode,
  products,
  siteUrl,
}: {
  article: AdminArticleDto;
  mode: 'create' | 'edit' | 'brand';
  products: ProductOption[];
  siteUrl: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(() => draftOf(article));
  const [locale, setLocale] = useState<Locale>('uz');
  const [files, setFiles] = useState<Record<string, string>>(article.files);
  const [cover, setCover] = useState(article.cover?.url ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const L = d[locale];
  const isBrand = mode === 'brand';

  const setL = (patch: Partial<LocaleDraft>) =>
    setD((x) => ({ ...x, [locale]: { ...x[locale], ...patch } }));
  const setBlocks = (blocks: Block[]) => setL({ blocks });

  async function upload(file: File | undefined): Promise<AdminUploadedImageDto | null> {
    if (!file) return null;
    setBusy('upload');
    setError(null);
    try {
      const r = await adminUpload<AdminUploadedImageDto>('/admin/content/images', file);
      setFiles((f) => ({ ...f, [r.fileId]: r.url }));
      return r;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setSaved(false);
    try {
      const body = {
        ...d,
        videoUrl: d.videoUrl || null,
        uz: { ...d.uz, blocks: cleanBlocks(d.uz.blocks) },
        ru: { ...d.ru, blocks: cleanBlocks(d.ru.blocks) },
      };
      const path = isBrand
        ? '/admin/content/brand'
        : mode === 'create'
          ? '/admin/content/articles'
          : `/admin/content/articles/${article.slug}`;
      const r = await adminFetch<AdminArticleDto>(path, {
        method: mode === 'create' ? 'POST' : 'PUT',
        body,
      });
      setSaved(true);
      if (!isBrand && (mode === 'create' || r.slug !== article.slug))
        router.replace(`/content/articles/${r.slug}`);
      else router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function aiSeo() {
    setBusy('ai');
    setError(null);
    try {
      const r = await adminFetch<{
        uz: { title: string; description: string };
        ru: { title: string; description: string };
        fake: boolean;
      }>('/admin/ai/seo', {
        method: 'POST',
        body: { path: isBrand ? '/brend' : `/ilhom/${article.slug}` },
      });
      setD((x) => ({
        ...x,
        uz: { ...x.uz, seoTitle: r.uz.title, seoDescription: r.uz.description },
        ru: { ...x.ru, seoTitle: r.ru.title, seoDescription: r.ru.description },
      }));
      setAiNote(
        r.fake
          ? 'Sinov rejimi: AI matni namunaviy. Tekshirib, o‘zingiz yozing.'
          : "AI taklifi maydonlarga qo'yildi. Tekshirib, keyin saqlang.",
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const publicPath = isBrand ? '/brend' : `/ilhom/${d.slug}`;

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-label="Maqola">
      <Panel className="flex flex-col gap-4 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex gap-1 self-start rounded-pill bg-canvas p-1"
            role="group"
            aria-label="Til"
          >
            {(['uz', 'ru'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => setLocale(l)}
                className={cn(
                  'rounded-pill px-4 py-1.5 text-xs font-semibold',
                  locale === l ? 'bg-ink text-white' : 'text-muted',
                )}
              >
                {l.toUpperCase()} {d[l].published ? '●' : '○'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <Switch
              checked={L.published}
              aria-label={`${locale.toUpperCase()} nashr qilingan`}
              data-testid="publish-toggle"
              onCheckedChange={(v) => setL({ published: v })}
            />
            {locale.toUpperCase()} saytda ko&apos;rinadi
          </label>
          {mode !== 'create' && article.locales[locale].published ? (
            <a
              href={`${siteUrl}/${locale}${publicPath}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs font-semibold text-forest"
            >
              Saytda ko&apos;rish ↗
            </a>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          Har bir til alohida nashr qilinadi. Sarlavhasi bo&apos;sh til saqlanmaydi.
        </p>

        <Field label={`Sarlavha · ${locale.toUpperCase()}`}>
          {(p) => (
            <Input
              {...p}
              className={small}
              value={L.title}
              maxLength={CMS_LIMITS.title}
              data-testid="article-title"
              onChange={(e) => setL({ title: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={`Qisqa mazmun · ${locale.toUpperCase()}`}
          hint="Kartochka va qidiruv tavsifi uchun"
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              className="min-h-16 text-sm"
              value={L.excerpt}
              maxLength={CMS_LIMITS.excerpt}
              onChange={(e) => setL({ excerpt: e.target.value })}
            />
          )}
        </Field>
      </Panel>

      {!isBrand ? (
        <Panel className="grid gap-3 p-5 text-[13px] sm:grid-cols-2 sm:p-[22px] lg:grid-cols-4">
          <Field
            label="Manzil (slug)"
            hint={mode === 'edit' ? "O'zgarsa, eski manzildan 301" : undefined}
          >
            {(p) => (
              <Input
                {...p}
                className={small}
                required
                value={d.slug}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                data-testid="article-slug"
                onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })}
              />
            )}
          </Field>
          <Field label="Bo'lim">
            {(p) => (
              <select
                {...p}
                className={selectClass}
                value={d.category ?? ''}
                onChange={(e) =>
                  setD({ ...d, category: (e.target.value || null) as ArticleCategory | null })
                }
              >
                <option value="">—</option>
                {ARTICLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="O'qish vaqti, daq">
            {(p) => (
              <Input
                {...p}
                className={small}
                type="number"
                min={1}
                max={120}
                value={d.readingMinutes ?? ''}
                onChange={(e) =>
                  setD({ ...d, readingMinutes: e.target.value ? Number(e.target.value) : null })
                }
              />
            )}
          </Field>
          <Field label="Tartib (kichigi oldin)">
            {(p) => (
              <Input
                {...p}
                className={small}
                type="number"
                min={0}
                value={d.sort}
                onChange={(e) => setD({ ...d, sort: Number(e.target.value) || 0 })}
              />
            )}
          </Field>
          <Field label="Video (https)" className="sm:col-span-2">
            {(p) => (
              <Input
                {...p}
                className={small}
                type="url"
                value={d.videoUrl}
                placeholder="https://youtube.com/…"
                onChange={(e) => setD({ ...d, videoUrl: e.target.value })}
              />
            )}
          </Field>
          <Field label="Video davomiyligi, daq">
            {(p) => (
              <Input
                {...p}
                className={small}
                type="number"
                min={1}
                value={d.videoMinutes ?? ''}
                onChange={(e) =>
                  setD({ ...d, videoMinutes: e.target.value ? Number(e.target.value) : null })
                }
              />
            )}
          </Field>
        </Panel>
      ) : null}

      <Panel className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <h2 className="text-lg font-semibold">Muqova rasmi</h2>
        <div className="flex flex-wrap items-center gap-3">
          {cover ? (
            <img src={cover} alt="" className="h-24 w-36 rounded-sm object-cover" />
          ) : (
            <span className="text-muted">Rasm tanlanmagan</span>
          )}
          <label className="cursor-pointer rounded-pill border border-line px-4 py-2 font-semibold hover:border-ink">
            {busy === 'upload' ? 'Yuklanmoqda…' : 'Rasm yuklash'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              data-testid="cover-upload"
              onChange={(e) =>
                void upload(e.target.files?.[0]).then((r) => {
                  if (!r) return;
                  setD((x) => ({ ...x, coverId: r.fileId }));
                  setCover(r.url);
                })
              }
            />
          </label>
          {cover ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setD({ ...d, coverId: null });
                setCover(null);
              }}
            >
              Olib tashlash
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Matn · {locale.toUpperCase()}</h2>
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_TYPES.map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setBlocks([...L.blocks, emptyBlock(t)])}
              >
                + {BLOCK_LABEL[t]}
              </Button>
            ))}
          </div>
        </div>
        {L.blocks.length === 0 ? <p className="text-muted">Hali blok yo&apos;q.</p> : null}
        <ol className="flex flex-col gap-3">
          {L.blocks.map((b, i) => (
            <BlockEditor
              key={i}
              block={b}
              index={i}
              count={L.blocks.length}
              files={files}
              uploading={busy === 'upload'}
              onUpload={upload}
              onChange={(nb) => setBlocks(L.blocks.map((x, j) => (j === i ? nb : x)))}
              onMove={(dir) => {
                const next = [...L.blocks];
                const [item] = next.splice(i, 1);
                next.splice(i + dir, 0, item!);
                setBlocks(next);
              }}
              onRemove={() => setBlocks(L.blocks.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      </Panel>

      {!isBrand ? (
        <Panel className="flex flex-col gap-2 p-5 text-[13px] sm:p-[22px]">
          <h2 className="text-lg font-semibold">Bog&apos;liq mahsulotlar</h2>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {products
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.relatedProductIds.includes(p.id)}
                    disabled={
                      !d.relatedProductIds.includes(p.id) &&
                      d.relatedProductIds.length >= CMS_LIMITS.relatedProducts
                    }
                    onChange={(e) =>
                      setD({
                        ...d,
                        relatedProductIds: e.target.checked
                          ? [...d.relatedProductIds, p.id]
                          : d.relatedProductIds.filter((x) => x !== p.id),
                      })
                    }
                  />
                  {p.name.uz || p.name.ru}
                </label>
              ))}
          </div>
        </Panel>
      ) : null}

      <Panel className="flex flex-col gap-3 p-5 text-[13px] sm:p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">SEO · {locale.toUpperCase()}</h2>
          {mode !== 'create' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busy === 'ai'}
              onClick={() => void aiSeo()}
              data-testid="ai-seo"
            >
              ✦ AI bilan taklif
            </Button>
          ) : null}
        </div>
        {aiNote ? (
          <p role="status" className="text-xs text-muted">
            {aiNote}
          </p>
        ) : null}
        <Field
          label={`Sarlavha (title) · ${L.seoTitle.length}/${SEO_TITLE_MAX}`}
          hint="Bo'sh = sarlavha | Forest"
        >
          {(p) => (
            <Input
              {...p}
              className={small}
              value={L.seoTitle}
              maxLength={SEO_TITLE_MAX}
              onChange={(e) => setL({ seoTitle: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={`Tavsif (description) · ${L.seoDescription.length}/${SEO_DESCRIPTION_MAX}`}
          hint="Bo'sh = qisqa mazmun"
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              className="min-h-16 text-sm"
              value={L.seoDescription}
              maxLength={SEO_DESCRIPTION_MAX}
              onChange={(e) => setL({ seoDescription: e.target.value })}
            />
          )}
        </Field>
      </Panel>

      <FormError message={error} />
      {saved ? (
        <p role="status" className="text-good" data-testid="article-saved">
          Saqlandi ✓
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === 'save'} data-testid="article-save">
          Saqlash
        </Button>
        {mode === 'edit' ? (
          <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
            O&apos;chirish
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={deleting}
        title="Maqola o'chirilsinmi?"
        confirmLabel="O'chirish"
        typed={article.slug}
        danger
        busy={busy === 'delete'}
        error={deleting ? error : null}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setBusy('delete');
          adminFetch(`/admin/content/articles/${article.slug}/delete`, {
            method: 'POST',
            body: { confirm: article.slug },
          })
            .then(() => router.replace('/content'))
            .catch((e: unknown) => setError(errorText(e)))
            .finally(() => setBusy(null));
        }}
      >
        <p>Maqola ikkala tilda ham saytdan olib tashlanadi.</p>
      </ConfirmDialog>
    </form>
  );
}

function BlockEditor({
  block: b,
  index,
  count,
  files,
  uploading,
  onUpload,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  index: number;
  count: number;
  files: Record<string, string>;
  uploading: boolean;
  onUpload: (f: File | undefined) => Promise<AdminUploadedImageDto | null>;
  onChange: (b: Block) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = `${index + 1}. ${BLOCK_LABEL[b.type]}`;
  const lines = (v: string) =>
    v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <li className="flex flex-col gap-2 rounded-md bg-off p-3">
      <div className="flex items-center gap-1">
        <b className="mr-auto text-xs font-semibold text-muted">{label}</b>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={`${label}: yuqoriga`}
        >
          ↑
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={`${label}: pastga`}
        >
          ↓
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`${label}: o'chirish`}
        >
          ✕
        </Button>
      </div>
      {b.type === 'h2' || b.type === 'h3' || b.type === 'p' || b.type === 'note' ? (
        <Textarea
          aria-label={label}
          rows={b.type === 'p' || b.type === 'note' ? 4 : 1}
          className="min-h-10 text-sm"
          value={b.text}
          maxLength={CMS_LIMITS.text}
          data-testid="block-text"
          onChange={(e) => onChange({ ...b, text: e.target.value })}
        />
      ) : null}
      {b.type === 'quote' ? (
        <>
          <Textarea
            aria-label={label}
            rows={2}
            className="min-h-10 text-sm"
            value={b.text}
            onChange={(e) => onChange({ ...b, text: e.target.value })}
          />
          <Input
            aria-label={`${label}: muallif`}
            className={small}
            placeholder="Muallif (ixtiyoriy)"
            value={b.cite}
            onChange={(e) => onChange({ ...b, cite: e.target.value })}
          />
        </>
      ) : null}
      {b.type === 'list' ? (
        <Textarea
          aria-label={`${label} (har qator — bir band)`}
          rows={4}
          className="min-h-16 text-sm"
          value={b.items.join('\n')}
          onChange={(e) => onChange({ ...b, items: lines(e.target.value) })}
        />
      ) : null}
      {b.type === 'faq' ? (
        <Textarea
          aria-label={`${label} (savol | javob, har qator)`}
          rows={4}
          className="min-h-16 text-sm"
          value={b.items.map((x) => `${x.q} | ${x.a}`).join('\n')}
          onChange={(e) =>
            onChange({
              ...b,
              items: lines(e.target.value).map((l) => {
                const [q, ...a] = l.split('|');
                return { q: (q ?? '').trim(), a: a.join('|').trim() };
              }),
            })
          }
        />
      ) : null}
      {b.type === 'image' ? (
        <div className="flex flex-wrap items-start gap-3">
          {files[b.fileId] ? (
            <img src={files[b.fileId]} alt="" className="h-20 w-28 rounded-sm object-cover" />
          ) : null}
          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            <label className="w-fit cursor-pointer rounded-pill border border-line px-4 py-1.5 text-xs font-semibold hover:border-ink">
              {uploading ? 'Yuklanmoqda…' : b.fileId ? 'Rasmni almashtirish' : 'Rasm yuklash'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) =>
                  void onUpload(e.target.files?.[0]).then(
                    (r) => r && onChange({ ...b, fileId: r.fileId }),
                  )
                }
              />
            </label>
            <Input
              aria-label={`${label}: alt matn`}
              className={small}
              placeholder="Rasm tavsifi (alt)"
              value={b.alt}
              onChange={(e) => onChange({ ...b, alt: e.target.value })}
            />
            <Input
              aria-label={`${label}: izoh`}
              className={small}
              placeholder="Izoh (ixtiyoriy)"
              value={b.caption}
              onChange={(e) => onChange({ ...b, caption: e.target.value })}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}
