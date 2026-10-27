'use client';

import {
  ADMIN_UPLOAD_MAX_BYTES,
  type AdminProductDto,
  type AdminProductImageDto,
} from '@forest/contracts/core';
import { Button, cn } from '@forest/ui';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { adminFetch, adminUpload } from '../../lib/client-api';
import type { ProductAction } from './use-product-action';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/** Moves `from` to `to` in a copy of `ids`. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** A11 "Rasmlar": upload (JPG/PNG/WebP ≤ 10 MB), drag or arrow ordering, alt UZ/RU, delete. */
export function ImagesTab({
  product,
  canEdit,
  action,
}: {
  product: AdminProductDto;
  canEdit: boolean;
  action: ProductAction;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const ids = product.images.map((i) => i.id);

  const reorder = (next: string[]) =>
    action.run('order', () =>
      adminFetch<AdminProductDto>(`/admin/products/${product.id}/images/order`, {
        method: 'PUT',
        body: { ids: next },
      }),
    );

  async function upload(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      if (file.size > ADMIN_UPLOAD_MAX_BYTES) {
        action.setError(`${file.name}: 10 MB dan katta`);
        continue;
      }
      await action.run('upload', () =>
        adminUpload<AdminProductDto>(`/admin/products/${product.id}/images`, file),
      );
    }
    if (input.current) input.current.value = '';
  }

  return (
    <div className="flex flex-col gap-3">
      {product.images.length === 0 ? (
        <p className="rounded-md bg-off p-6 text-center text-muted">
          Rasm yo&apos;q. Saytda mahsulot rasmsiz ko&apos;rinadi — kamida bitta rasm qo&apos;shing.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Rasmlar tartibi">
          {product.images.map((img, i) => (
            <li
              key={img.id}
              draggable={canEdit}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) void reorder(moveId(ids, dragging, i));
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                'flex flex-col gap-2 rounded-md border border-line-soft bg-off p-2',
                canEdit && 'cursor-grab',
                over === i && dragging !== i && 'border-forest',
                dragging === i && 'opacity-50',
              )}
              data-testid="product-image"
            >
              <div className="relative">
                <Image
                  src={img.url}
                  alt={img.alt.uz}
                  width={240}
                  height={180}
                  unoptimized
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                />
                <span className="absolute top-1 left-1 rounded-pill bg-ink px-2 text-[11px] font-bold text-white">
                  {i === 0 ? 'Asosiy' : i + 1}
                </span>
              </div>
              <span className="text-[11px] text-muted">
                {img.width && img.height ? `${img.width}×${img.height}` : ''}
              </span>
              <AltEditor image={img} canEdit={canEdit} action={action} />
              {canEdit ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Oldinga"
                    disabled={i === 0 || !!action.busy}
                    onClick={() => void reorder(moveId(ids, i, i - 1))}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Orqaga"
                    disabled={i === ids.length - 1 || !!action.busy}
                    onClick={() => void reorder(moveId(ids, i, i + 1))}
                  >
                    →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-critical"
                    aria-label="Rasmni o'chirish"
                    disabled={!!action.busy}
                    onClick={() => {
                      if (window.confirm("Rasm o'chirilsinmi?"))
                        void action.run('delete-img', () =>
                          adminFetch<AdminProductDto>(`/admin/products/images/${img.id}`, {
                            method: 'DELETE',
                          }),
                        );
                    }}
                  >
                    ✕
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            id="product-image-upload"
            onChange={(e) => void upload(e.target.files)}
            data-testid="image-upload"
          />
          <label
            htmlFor="product-image-upload"
            className="inline-flex h-11 cursor-pointer items-center rounded-pill border border-dashed border-line px-5 text-sm font-semibold hover:border-ink focus-within:outline-2"
          >
            {action.busy === 'upload' ? 'Yuklanmoqda…' : '+ rasm'}
          </label>
          <span className="text-xs text-muted">
            JPG, PNG yoki WebP, 10 MB gacha. Sudrab yoki ← → bilan tartiblang. Video — «Asosiy»dagi
            havola.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function AltEditor({
  image,
  canEdit,
  action,
}: {
  image: AdminProductImageDto;
  canEdit: boolean;
  action: ProductAction;
}) {
  const [alt, setAlt] = useState(image.alt);
  useEffect(() => setAlt(image.alt), [image.alt]);
  const dirty = alt.uz !== image.alt.uz || alt.ru !== image.alt.ru;
  return (
    <div className="flex flex-col gap-1">
      {(['uz', 'ru'] as const).map((l) => (
        <input
          key={l}
          aria-label={`Alt matn ${l.toUpperCase()}`}
          placeholder={`Alt · ${l.toUpperCase()}`}
          className="h-8 rounded-xs border border-line bg-panel px-2 text-xs disabled:bg-off"
          value={alt[l]}
          disabled={!canEdit}
          maxLength={200}
          onChange={(e) => setAlt({ ...alt, [l]: e.target.value })}
        />
      ))}
      {canEdit && dirty ? (
        <Button
          size="sm"
          variant="outline"
          loading={action.busy === `alt-${image.id}`}
          onClick={() =>
            void action.run(`alt-${image.id}`, () =>
              adminFetch<AdminProductDto>(`/admin/products/images/${image.id}`, {
                method: 'PATCH',
                body: { alt },
              }),
            )
          }
        >
          Alt saqlash
        </Button>
      ) : null}
    </div>
  );
}
