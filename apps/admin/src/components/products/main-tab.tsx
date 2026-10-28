'use client';

import {
  type AdminCategoryOptionDto,
  type AdminProductDto,
  type AdminSpecDto,
  type AiProductDescriptionDraftDto,
  PRODUCT_BADGES,
  PRODUCT_STATUSES,
  RELATION_KINDS,
  type RelationKind,
  SURFACES,
} from '@forest/contracts/core';
import { Button, Field, Input, Switch } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { BADGE_LABEL, COPY, PRODUCT_STATUS_LABEL, RELATION_LABEL, SURFACE_LABEL } from './copy';
import { ChipToggles, compactInput, LocalizedInput, NumberInput, selectClass } from './fields';
import type { ProductAction } from './use-product-action';

interface Option {
  id: string;
  name: { uz: string; ru: string };
  status: string;
}

function draftOf(p: AdminProductDto) {
  return {
    name: p.name,
    shortDesc: p.shortDesc,
    description: p.description,
    howToApply: p.howToApply,
    status: p.status,
    categoryIds: p.categoryIds,
    badges: p.badges,
    surfaces: p.surfaces,
    isBestseller: p.isBestseller,
    videoUrl: p.videoUrl ?? '',
    coverageM2PerL: p.coverageM2PerL,
    dryTimeMinutes: p.dryTimeMinutes,
    keywords: p.keywords.join(', '),
    specs: p.specs,
  };
}

/** A11 "Asosiy": names, texts, category, badge, status, channels, specs, relations. */
export function MainTab({
  product,
  categories,
  canEdit,
  action,
}: {
  product: AdminProductDto;
  categories: AdminCategoryOptionDto[];
  canEdit: boolean;
  action: ProductAction;
}) {
  const router = useRouter();
  const [d, setD] = useState(() => draftOf(product));
  useEffect(() => setD(draftOf(product)), [product]);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const off = !canEdit;
  const [ai, setAi] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });

  /** AI draft (CLAUDE.md §6): fills the two description fields; nothing is saved until "Saqlash". */
  async function aiDraft() {
    setAi({ busy: true, note: null });
    try {
      const r = await adminFetch<AiProductDescriptionDraftDto>('/admin/ai/product-description', {
        method: 'POST',
        body: { productId: product.id },
      });
      setD((x) => ({ ...x, shortDesc: r.shortDesc, description: r.description }));
      setAi({ busy: false, note: r.fake ? COPY.aiDraftFake : COPY.aiDraftReady });
    } catch (e) {
      setAi({ busy: false, note: errorText(e) });
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await action.run(
      'main',
      () =>
        adminFetch<AdminProductDto>(`/admin/products/${product.id}`, {
          method: 'PATCH',
          body: {
            ...d,
            videoUrl: d.videoUrl.trim(),
            keywords: d.keywords
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          },
        }),
      COPY.saved,
    );
  }

  async function remove() {
    if (!window.confirm(COPY.deleteConfirm)) return;
    const ok = await action.run('delete', () =>
      adminFetch<void>(`/admin/products/${product.id}`, { method: 'DELETE' }),
    );
    if (ok) router.push('/products');
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-label="Asosiy ma'lumotlar">
      <LocalizedInput
        label="Nomi"
        value={d.name}
        onChange={(v) => set('name', v)}
        disabled={off}
        required
        maxLength={160}
        testId="product-name"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Holat">
          {(p) => (
            <select
              {...p}
              className={selectClass}
              value={d.status}
              disabled={off}
              onChange={(e) => set('status', e.target.value as typeof d.status)}
              data-testid="product-status"
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PRODUCT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex items-center justify-between gap-3 self-end rounded-sm bg-off px-3 py-2.5">
          <label htmlFor="product-bestseller" className="font-semibold">
            Bestseller (bosh sahifa)
          </label>
          <Switch
            id="product-bestseller"
            checked={d.isBestseller}
            disabled={off}
            onCheckedChange={(v) => set('isBestseller', v)}
          />
        </div>
      </div>
      <ChipToggles
        label="Kategoriya"
        options={categories.map((c) => ({ value: c.id, label: c.name.uz }))}
        value={d.categoryIds}
        onChange={(v) => set('categoryIds', v)}
        disabled={off}
      />
      <ChipToggles
        label="Belgi"
        options={PRODUCT_BADGES.map((b) => ({ value: b, label: BADGE_LABEL[b] }))}
        value={d.badges as (typeof PRODUCT_BADGES)[number][]}
        onChange={(v) => set('badges', v)}
        disabled={off}
      />
      <ChipToggles
        label="Sirt (katalog filtri)"
        options={SURFACES.map((s) => ({ value: s, label: SURFACE_LABEL[s] ?? s }))}
        value={d.surfaces as (typeof SURFACES)[number][]}
        onChange={(v) => set('surfaces', v)}
        disabled={off}
      />

      <fieldset className="flex flex-col gap-2 rounded-sm bg-off p-3">
        <legend className="sr-only">{COPY.channels}</legend>
        <span className="font-semibold">{COPY.channels}</span>
        <span className="flex flex-wrap gap-2">
          <span className={d.status === 'ACTIVE' ? 'font-semibold text-good' : 'text-muted'}>
            {d.status === 'ACTIVE' ? '✓' : '—'} {COPY.channelSite}
          </span>
          <span className="text-muted">· {COPY.channelsLater}</span>
        </span>
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Tavsiflar</span>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={ai.busy}
            title={COPY.aiDraftHint}
            onClick={() => void aiDraft()}
            data-testid="ai-description"
          >
            ✦ {COPY.aiDraft}
          </Button>
        ) : null}
      </div>
      {ai.note ? (
        <p role="status" className="text-xs text-muted" data-testid="ai-note">
          {ai.note}
        </p>
      ) : null}
      <LocalizedInput
        label="Qisqa tavsif"
        value={d.shortDesc}
        onChange={(v) => set('shortDesc', v)}
        disabled={off}
        multiline
        rows={2}
        maxLength={400}
      />
      <LocalizedInput
        label="To'liq tavsif"
        value={d.description}
        onChange={(v) => set('description', v)}
        disabled={off}
        multiline
        rows={6}
        maxLength={8000}
      />
      <LocalizedInput
        label="Qo'llash (har qator — bir qadam)"
        value={d.howToApply}
        onChange={(v) => set('howToApply', v)}
        disabled={off}
        multiline
        rows={4}
        maxLength={4000}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sarf, m²/L">
          {(p) => (
            <NumberInput
              {...p}
              step="any"
              min={0}
              value={d.coverageM2PerL}
              disabled={off}
              onChange={(v) => set('coverageM2PerL', v)}
            />
          )}
        </Field>
        <Field label="Qurish vaqti, daqiqa">
          {(p) => (
            <NumberInput
              {...p}
              min={1}
              value={d.dryTimeMinutes}
              disabled={off}
              onChange={(v) => set('dryTimeMinutes', v)}
            />
          )}
        </Field>
        <Field label="Video (URL)">
          {(p) => (
            <Input
              {...p}
              type="url"
              className={compactInput}
              value={d.videoUrl}
              disabled={off}
              onChange={(e) => set('videoUrl', e.target.value)}
            />
          )}
        </Field>
      </div>

      <Specs specs={d.specs} onChange={(v) => set('specs', v)} disabled={off} />

      <Field label="Qidiruv so'zlari" hint="Vergul bilan: kraska, краска, boyoq…">
        {(p) => (
          <Input
            {...p}
            className={compactInput}
            value={d.keywords}
            disabled={off}
            onChange={(e) => set('keywords', e.target.value)}
          />
        )}
      </Field>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={action.busy === 'main'} data-testid="product-save">
            {COPY.save}
          </Button>
          {product.status === 'DRAFT' ? (
            <Button
              type="button"
              variant="danger"
              loading={action.busy === 'delete'}
              onClick={() => void remove()}
            >
              {COPY.deleteDraft}
            </Button>
          ) : (
            <span className="text-xs text-muted">{COPY.archiveHint}</span>
          )}
        </div>
      ) : null}

      <Relations product={product} canEdit={canEdit} action={action} />
    </form>
  );
}

function Specs({
  specs,
  onChange,
  disabled,
}: {
  specs: AdminSpecDto[];
  onChange: (v: AdminSpecDto[]) => void;
  disabled: boolean;
}) {
  const update = (i: number, part: 'key' | 'value', l: 'uz' | 'ru', v: string) =>
    onChange(specs.map((s, j) => (j === i ? { ...s, [part]: { ...s[part], [l]: v } } : s)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-[13px] font-semibold">Xususiyatlar</legend>
      {specs.map((s, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-off p-2"
        >
          {(['uz', 'ru'] as const).map((l) => (
            <div key={l} className="flex min-w-0 flex-col gap-1">
              <input
                aria-label={`Nomi ${l.toUpperCase()} ${i + 1}`}
                className="h-9 w-full min-w-0 rounded-xs border border-line bg-panel px-2 text-sm"
                value={s.key[l]}
                disabled={disabled}
                onChange={(e) => update(i, 'key', l, e.target.value)}
                placeholder={`Nomi · ${l.toUpperCase()}`}
              />
              <input
                aria-label={`Qiymat ${l.toUpperCase()} ${i + 1}`}
                className="h-9 w-full min-w-0 rounded-xs border border-line bg-panel px-2 text-sm"
                value={s.value[l]}
                disabled={disabled}
                onChange={(e) => update(i, 'value', l, e.target.value)}
                placeholder={`Qiymat · ${l.toUpperCase()}`}
              />
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Xususiyat ${i + 1} ni olib tashlash`}
            onClick={() => onChange(specs.filter((_, j) => j !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      {!disabled ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            onChange([...specs, { key: { uz: '', ru: '' }, value: { uz: '', ru: '' } }])
          }
        >
          + Xususiyat
        </Button>
      ) : null}
    </fieldset>
  );
}

/** Cross-sell / upsell / alternatives: one ordered multi-pick per kind, saved separately. */
function Relations({
  product,
  canEdit,
  action,
}: {
  product: AdminProductDto;
  canEdit: boolean;
  action: ProductAction;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  useEffect(() => {
    let alive = true;
    adminFetch<Option[]>('/admin/products/options')
      .then((o) => alive && setOptions(o.filter((x) => x.id !== product.id)))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [product.id]);

  const save = (kind: RelationKind, ids: string[]) =>
    action.run(`rel-${kind}`, () =>
      adminFetch<AdminProductDto>(`/admin/products/${product.id}/relations`, {
        method: 'PUT',
        body: { kind, productIds: ids },
      }),
    );

  return (
    <section
      className="flex flex-col gap-3 border-t border-line-soft pt-4"
      aria-label="Bog'liq mahsulotlar"
    >
      <span className="font-semibold">Bog&apos;liq mahsulotlar</span>
      {RELATION_KINDS.map((kind) => {
        const current = product.relations[kind];
        const free = (options ?? []).filter((o) => !current.some((c) => c.id === o.id));
        return (
          <div key={kind} className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">{RELATION_LABEL[kind]}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {current.length === 0 ? <span className="text-xs text-subtle">—</span> : null}
              {current.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex h-8 items-center gap-1 rounded-pill bg-canvas pr-1 pl-3 text-xs font-semibold"
                >
                  {c.name.uz}
                  {c.status !== 'ACTIVE' ? (
                    <span className="text-muted">({c.status.toLowerCase()})</span>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`${c.name.uz} ni olib tashlash`}
                      className="grid size-6 place-items-center rounded-full hover:bg-sage"
                      onClick={() =>
                        void save(
                          kind,
                          current.filter((x) => x.id !== c.id).map((x) => x.id),
                        )
                      }
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              ))}
              {canEdit && free.length > 0 ? (
                <select
                  aria-label={`${RELATION_LABEL[kind]}: qo'shish`}
                  className="h-8 rounded-pill bg-canvas px-2 text-xs font-semibold"
                  value=""
                  disabled={action.busy === `rel-${kind}`}
                  onChange={(e) =>
                    e.target.value && void save(kind, [...current.map((x) => x.id), e.target.value])
                  }
                >
                  <option value="">+ qo&apos;shish</option>
                  {free.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name.uz}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
