'use client';

import {
  type AdminCategoryOptionDto,
  type AdminProductDto,
  PRODUCT_TYPES,
  slugify,
} from '@forest/contracts/core';
import { Button, Field, Input } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { FormError } from '../auth-card';
import { adminFetch, errorText } from '../../lib/client-api';
import { COPY } from './copy';

const selectClass =
  'h-[52px] w-full rounded-sm border border-line bg-panel px-4 text-[15px] focus:border-ink focus:outline-none';

/** "+ Mahsulot": a modal with the minimum to start a draft (names, slug, category, type). */
export function CreateProductButton({ categories }: { categories: AdminCategoryOptionDto[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameUz, setNameUz] = useState('');

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const category = String(f.get('category') ?? '');
      const created = await adminFetch<AdminProductDto>('/admin/products', {
        method: 'POST',
        body: {
          name: { uz: String(f.get('nameUz') ?? ''), ru: String(f.get('nameRu') ?? '') },
          slug: String(f.get('slug') ?? ''),
          type: String(f.get('type') ?? 'SIMPLE'),
          categoryIds: category ? [category] : [],
        },
      });
      setOpen(false);
      router.push(`/products?id=${created.id}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="product-create">
        {COPY.add}
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="create-product-title"
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-lg bg-panel p-0 text-ink backdrop:bg-ink/40"
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-6">
          <h2 id="create-product-title" className="text-xl font-semibold">
            Yangi mahsulot
          </h2>
          <p className="text-[13px] text-muted">
            Qoralama sifatida yaratiladi: variant, IKPU va rasm qo&apos;shib, keyin faollashtiring.
          </p>
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomi · UZ">
              {(p) => (
                <Input
                  {...p}
                  name="nameUz"
                  required
                  maxLength={160}
                  value={nameUz}
                  onChange={(e) => setNameUz(e.target.value)}
                />
              )}
            </Field>
            <Field label="Nomi · RU">
              {(p) => <Input {...p} name="nameRu" required maxLength={160} />}
            </Field>
            <Field label="Manzil (slug)" hint={`/p/${slugify(nameUz) || '…'}`}>
              {(p) => (
                <Input
                  {...p}
                  name="slug"
                  placeholder={slugify(nameUz)}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                />
              )}
            </Field>
            <Field label="Kategoriya">
              {(p) => (
                <select {...p} name="category" className={selectClass} defaultValue="">
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name.uz}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Turi">
              {(p) => (
                <select {...p} name="type" className={selectClass} defaultValue="SIMPLE">
                  {PRODUCT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'SIMPLE' ? 'Oddiy mahsulot' : "To'plam"}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" loading={busy}>
              Yaratish
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
