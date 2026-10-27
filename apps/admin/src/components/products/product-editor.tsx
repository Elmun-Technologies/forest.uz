'use client';

import type { AdminCategoryOptionDto, AdminProductDto } from '@forest/contracts/core';
import { Badge, buttonClasses, cn, Panel } from '@forest/ui';
import Image from 'next/image';
import { useState } from 'react';
import { FormError } from '../auth-card';
import {
  COPY,
  PRODUCT_STATUS_LABEL,
  PRODUCT_STATUS_TONE,
  PRODUCT_TABS,
  type ProductTab,
} from './copy';
import { ImagesTab } from './images-tab';
import { MainTab } from './main-tab';
import { SeoTab } from './seo-tab';
import { useProductAction } from './use-product-action';
import { VariantsTab } from './variants-tab';

/** A11 editor panel (design Admin-Mahsulotlar): header, Asosiy / Variantlar / Rasmlar / SEO. */
export function ProductEditor({
  initial,
  categories,
  canEdit,
  siteUrl,
  lowStockDefault,
}: {
  initial: AdminProductDto;
  categories: AdminCategoryOptionDto[];
  canEdit: boolean;
  siteUrl: string;
  lowStockDefault: number;
}) {
  const [product, setProduct] = useState(initial);
  const [tab, setTab] = useState<ProductTab>('main');
  const action = useProductAction(setProduct);
  const cover = product.images[0];
  const live = product.status === 'ACTIVE';

  return (
    <Panel
      as="section"
      aria-label={`${product.name.uz} — tahrirlash`}
      className="flex min-w-0 flex-col gap-4 p-5 text-[13px] sm:p-[22px] xl:sticky xl:top-4"
      data-testid="product-editor"
    >
      <header className="flex items-center gap-3">
        {cover ? (
          <Image
            src={cover.url}
            alt=""
            width={64}
            height={64}
            unoptimized
            className="size-16 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <span aria-hidden className="size-16 shrink-0 rounded-sm bg-canvas" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-xl font-medium tracking-[-0.02em]">{product.name.uz}</h2>
          <span className="text-muted">
            {COPY.seller}: {product.seller.name}
            {product.seller.isOfficial ? ` · ${COPY.official}` : ''}
          </span>
        </div>
        <Badge tone={PRODUCT_STATUS_TONE[product.status]}>
          {PRODUCT_STATUS_LABEL[product.status]}
        </Badge>
      </header>

      <div
        role="tablist"
        aria-label="Mahsulot bo'limlari"
        className="flex gap-1 self-start rounded-pill bg-canvas p-1"
      >
        {PRODUCT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`product-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`product-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-pill px-4 py-[9px] text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-forest',
              tab === t.id ? 'bg-ink text-white' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.id === 'variants' && product.variants.some((v) => v.active && v.ikpuMissing) ? (
              <span className="ml-1 text-critical" aria-label="IKPU yo'q">
                •
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {!canEdit ? <p className="rounded-sm bg-off px-3 py-2 text-muted">{COPY.readOnly}</p> : null}
      <FormError message={action.error} />
      {action.notice ? (
        <p role="status" className="rounded-sm bg-good-bg px-3 py-2 font-semibold text-good">
          {action.notice}
        </p>
      ) : null}

      <div role="tabpanel" id={`product-panel-${tab}`} aria-labelledby={`product-tab-${tab}`}>
        {tab === 'main' ? (
          <MainTab product={product} categories={categories} canEdit={canEdit} action={action} />
        ) : tab === 'variants' ? (
          <VariantsTab
            product={product}
            canEdit={canEdit}
            action={action}
            lowStockDefault={lowStockDefault}
          />
        ) : tab === 'images' ? (
          <ImagesTab product={product} canEdit={canEdit} action={action} />
        ) : (
          <SeoTab product={product} canEdit={canEdit} action={action} siteUrl={siteUrl} />
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
        {live ? (
          <a
            href={`${siteUrl}/uz/p/${product.slug}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClasses('outline', 'md', true)}
            data-testid="view-on-site"
          >
            {COPY.viewOnSite}
          </a>
        ) : (
          <span
            className={cn(buttonClasses('outline', 'md', true), 'cursor-not-allowed opacity-50')}
            title={COPY.viewOnSiteDisabled}
            aria-disabled="true"
          >
            {COPY.viewOnSite}
          </span>
        )}
      </footer>
    </Panel>
  );
}
