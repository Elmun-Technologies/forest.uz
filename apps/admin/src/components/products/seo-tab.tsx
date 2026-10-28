'use client';

import {
  type AdminProductDto,
  type AiSeoDraftDto,
  productSeoTitle,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from '@forest/contracts/core';
import { Button, cn, Field, Input, Textarea } from '@forest/ui';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { COPY } from './copy';
import { compactInput } from './fields';
import type { ProductAction } from './use-product-action';

type Locale = 'uz' | 'ru';

const draftOf = (p: AdminProductDto) => ({
  slug: p.slug,
  seo: {
    uz: { title: p.seo.uz.title, description: p.seo.uz.description },
    ru: { title: p.seo.ru.title, description: p.seo.ru.description },
  },
});

/** A11 "SEO": slug (301 on change), title/description per locale with SERP preview. */
export function SeoTab({
  product,
  canEdit,
  action,
  siteUrl,
}: {
  product: AdminProductDto;
  canEdit: boolean;
  action: ProductAction;
  siteUrl: string;
}) {
  const [d, setD] = useState(() => draftOf(product));
  const [locale, setLocale] = useState<Locale>('uz');
  useEffect(() => setD(draftOf(product)), [product]);
  const off = !canEdit;
  const host = siteUrl.replace(/^https?:\/\//, '');
  const title =
    d.seo[locale].title || productSeoTitle(product.name[locale] || product.name.uz, locale);
  const description =
    d.seo[locale].description || product.shortDesc[locale] || product.shortDesc.uz;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (d.slug !== product.slug && !window.confirm(`${COPY.slugWarn} Davom etasizmi?`)) return;
    await action.run(
      'seo',
      () =>
        adminFetch<AdminProductDto>(`/admin/products/${product.id}`, {
          method: 'PATCH',
          body: d.slug !== product.slug ? d : { seo: d.seo },
        }),
      COPY.saved,
    );
  }

  const [ai, setAi] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });

  /** AI SEO draft for both locales (CLAUDE.md §6): fills the fields, saving stays manual. */
  async function aiSuggest() {
    setAi({ busy: true, note: null });
    try {
      const r = await adminFetch<AiSeoDraftDto>('/admin/ai/seo', {
        method: 'POST',
        body: { path: `/p/${product.slug}` },
      });
      setD((x) => ({ ...x, seo: { uz: r.uz, ru: r.ru } }));
      setAi({ busy: false, note: r.fake ? COPY.aiDraftFake : COPY.aiDraftReady });
    } catch (e) {
      setAi({ busy: false, note: errorText(e) });
    }
  }

  const setSeo = (field: 'title' | 'description', value: string) =>
    setD((x) => ({ ...x, seo: { ...x.seo, [locale]: { ...x.seo[locale], [field]: value } } }));

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-label="SEO">
      <Field label="Manzil (slug)" hint={COPY.slugWarn}>
        {(p) => (
          <Input
            {...p}
            className={compactInput}
            value={d.slug}
            disabled={off}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })}
          />
        )}
      </Field>

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
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <Field
        label={`Sarlavha (title) · ${d.seo[locale].title.length}/${SEO_TITLE_MAX}`}
        hint={COPY.seoTemplateHint}
      >
        {(p) => (
          <Input
            {...p}
            className={compactInput}
            value={d.seo[locale].title}
            maxLength={SEO_TITLE_MAX}
            disabled={off}
            placeholder={productSeoTitle(product.name[locale] || product.name.uz, locale)}
            onChange={(e) => setSeo('title', e.target.value)}
          />
        )}
      </Field>
      <Field
        label={`Tavsif (description) · ${d.seo[locale].description.length}/${SEO_DESCRIPTION_MAX}`}
      >
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            className="min-h-20 text-sm"
            value={d.seo[locale].description}
            maxLength={SEO_DESCRIPTION_MAX}
            disabled={off}
            onChange={(e) => setSeo('description', e.target.value)}
          />
        )}
      </Field>

      <figure
        className="flex flex-col gap-1 rounded-md border border-line-soft bg-off p-4"
        aria-label="Google ko'rinishi"
      >
        <span className="text-xs text-muted">
          {host} › {locale} › p › {d.slug}
        </span>
        <span className="text-[17px] leading-snug text-[#1a0dab]">
          {title.length > SEO_TITLE_MAX + 5 ? `${title.slice(0, SEO_TITLE_MAX + 2)}…` : title}
        </span>
        <span className="text-[13px] leading-relaxed text-muted">
          {description.length > SEO_DESCRIPTION_MAX
            ? `${description.slice(0, SEO_DESCRIPTION_MAX)}…`
            : description}
        </span>
      </figure>
      <p className="text-xs text-muted">
        {COPY.seoStorefrontNote}{' '}
        <Link
          href="/seo"
          prefetch={false}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {COPY.seoCenter}
        </Link>
        .
      </p>

      {ai.note ? (
        <p role="status" className="text-xs text-muted">
          {ai.note}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={action.busy === 'seo'}>
            {COPY.save}
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={ai.busy}
            title={COPY.aiDraftHint}
            onClick={() => void aiSuggest()}
            data-testid="ai-seo"
          >
            ✦ AI bilan taklif
          </Button>
        </div>
      ) : null}
    </form>
  );
}
