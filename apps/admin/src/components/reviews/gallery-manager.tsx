'use client';

import type { AdminGalleryItemDto, AdminReviewDto } from '@forest/contracts/core';
import { Button, cn, Panel } from '@forest/ui';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, adminUpload, errorText } from '../../lib/client-api';
import { moveId } from '../products/images-tab';
import { COPY } from './copy';

/**
 * A15 "Natijalar" gallery (home + product pages): drag or arrow ordering, before/after pairing
 * from the customer's photos or a staff "before" upload, removal.
 */
export function GalleryManager({
  initial,
  canModerate,
}: {
  initial: AdminGalleryItemDto[];
  canModerate: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dragging, setDragging] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setItems(initial), [initial]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const reorder = (ids: string[]) =>
    run(async () =>
      setItems(
        await adminFetch<AdminGalleryItemDto[]>('/admin/reviews/gallery/order', {
          method: 'PUT',
          body: { ids },
        }),
      ),
    );
  const ids = items.map((i) => i.reviewId);
  const current = items.find((i) => i.reviewId === editing) ?? null;

  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 p-5 sm:p-[22px]"
      aria-labelledby="gallery-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gallery-title" className="text-xl font-semibold">
          {COPY.galleryTitle}
        </h2>
        <span className="text-xs text-muted">{COPY.galleryHint}</span>
      </div>
      <FormError message={error} />
      {items.length === 0 ? (
        <p className="rounded-md bg-off p-6 text-center text-sm text-muted">{COPY.galleryEmpty}</p>
      ) : (
        <ol
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
          aria-label="Galereya tartibi"
        >
          {items.map((g, i) => (
            <li
              key={g.reviewId}
              draggable={canModerate}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => dragging !== null && e.preventDefault()}
              onDragEnd={() => setDragging(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) void reorder(moveId(ids, dragging, i));
                setDragging(null);
              }}
              className={cn(
                'flex flex-col gap-1.5',
                canModerate && 'cursor-grab',
                dragging === i && 'opacity-50',
                busy && 'pointer-events-none opacity-70',
              )}
              data-testid="gallery-item"
            >
              <button
                type="button"
                onClick={() => setEditing(editing === g.reviewId ? null : g.reviewId)}
                aria-expanded={editing === g.reviewId}
                className="relative overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-forest"
                aria-label={`${g.productName.uz}, ${g.author}: juftlikni tahrirlash`}
              >
                <Image
                  src={g.after.url}
                  alt=""
                  width={220}
                  height={220}
                  unoptimized
                  className="aspect-square w-full object-cover"
                />
                {g.before ? (
                  <Image
                    src={g.before.url}
                    alt=""
                    width={80}
                    height={80}
                    unoptimized
                    className="absolute bottom-1.5 left-1.5 size-14 rounded-sm border-2 border-white object-cover"
                  />
                ) : null}
                <span className="absolute top-1.5 left-1.5 rounded-pill bg-ink px-2 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
              </button>
              <span className="truncate text-xs">
                <b className="font-semibold">{g.productName.uz}</b> · {g.author}
              </span>
              {canModerate ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Oldinga"
                    disabled={i === 0 || busy}
                    onClick={() => void reorder(moveId(ids, i, i - 1))}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Orqaga"
                    disabled={i === ids.length - 1 || busy}
                    onClick={() => void reorder(moveId(ids, i, i + 1))}
                  >
                    →
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
          {canModerate ? (
            <li className="grid aspect-square place-items-center rounded-md border border-dashed border-line p-3 text-center text-xs text-muted">
              + {COPY.pair}: rasmni bosing
            </li>
          ) : null}
        </ol>
      )}
      {current ? (
        <PairEditor
          key={current.reviewId}
          item={current}
          canModerate={canModerate}
          busy={busy}
          run={run}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

function PairEditor({
  item,
  canModerate,
  busy,
  run,
  onClose,
}: {
  item: AdminGalleryItemDto;
  canModerate: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const patch = (body: object) =>
    run(() =>
      adminFetch<AdminReviewDto>(`/admin/reviews/${item.reviewId}/gallery`, {
        method: 'PATCH',
        body,
      }),
    );

  return (
    <div
      className="flex flex-col gap-3 rounded-md bg-off p-4 text-[13px]"
      aria-label="Oldin/keyin juftligi"
    >
      <div className="flex items-center justify-between">
        <b className="font-semibold">
          {item.productName.uz} · {item.author}
        </b>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Yopish
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {item.photos.map((p) => {
          const isAfter = p.fileId === item.after.fileId;
          const isBefore = p.fileId === item.before?.fileId;
          return (
            <div key={p.fileId} className="flex w-[120px] flex-col gap-1">
              <Image
                src={p.url}
                alt=""
                width={120}
                height={120}
                unoptimized
                className="aspect-square rounded-sm object-cover"
              />
              {canModerate ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant={isAfter ? 'primary' : 'outline'}
                    disabled={busy || isAfter}
                    onClick={() =>
                      void patch({
                        afterFileId: p.fileId,
                        ...(isBefore ? { beforeFileId: null } : {}),
                      })
                    }
                  >
                    {COPY.after}
                  </Button>
                  <Button
                    size="sm"
                    variant={isBefore ? 'primary' : 'outline'}
                    disabled={busy || isAfter}
                    onClick={() => void patch({ beforeFileId: isBefore ? null : p.fileId })}
                  >
                    {COPY.before}
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
        {item.before && !item.photos.some((p) => p.fileId === item.before?.fileId) ? (
          <div className="flex w-[120px] flex-col gap-1">
            <Image
              src={item.before.url}
              alt=""
              width={120}
              height={120}
              unoptimized
              className="aspect-square rounded-sm object-cover"
            />
            <span className="text-xs text-muted">{COPY.before} (yuklangan)</span>
          </div>
        ) : null}
      </div>
      {canModerate ? (
        <div className="flex flex-wrap gap-2">
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id={`before-${item.reviewId}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void run(() =>
                  adminUpload<AdminReviewDto>(`/admin/reviews/${item.reviewId}/before-photo`, f),
                );
              e.target.value = '';
            }}
          />
          <label
            htmlFor={`before-${item.reviewId}`}
            className="inline-flex h-9 cursor-pointer items-center rounded-pill border border-dashed border-line px-4 font-semibold hover:border-ink"
          >
            {COPY.uploadBefore}
          </label>
          {item.before ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void patch({ beforeFileId: null })}
            >
              Juftlikni olib tashlash
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Galereyadan olinsinmi? Sharh saytda qoladi.')) {
                void patch({ inGallery: false });
                onClose();
              }
            }}
          >
            {COPY.removeFromGallery}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
