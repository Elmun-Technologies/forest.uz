'use client';

import type { AdminProductDto, AdminVariantDto, LocalizedText } from '@forest/contracts/core';
import { Button, cn, Field, Input, Switch } from '@forest/ui';
import { type FormEvent, useState } from 'react';
import { adminFetch } from '../../lib/client-api';
import { COPY } from './copy';
import { compactInput, LocalizedInput, NumberInput } from './fields';
import { soum } from './format';
import type { ProductAction } from './use-product-action';

interface Draft {
  sku: string;
  label: LocalizedText;
  ikpu: string;
  packageCode: string;
  vatPercent: number | null;
  priceSoum: number | null;
  compareAtSoum: number | null;
  stock: number | null;
  lowStockAt: number | null;
  weightGrams: number | null;
  volumeMl: number | null;
  colorHex: string;
  barcode: string;
  active: boolean;
}

const draftOf = (v: AdminVariantDto | null, lowStockDefault: number): Draft => ({
  sku: v?.sku ?? '',
  label: v?.label ?? { uz: '', ru: '' },
  ikpu: v?.ikpu ?? '',
  packageCode: v?.packageCode ?? '',
  vatPercent: v?.vatPercent ?? 12,
  priceSoum: v?.priceSoum ?? null,
  compareAtSoum: v?.compareAtSoum ?? null,
  stock: v?.stock ?? 0,
  lowStockAt: v?.lowStockAt ?? lowStockDefault,
  weightGrams: v?.weightGrams ?? null,
  volumeMl: v?.volumeMl ?? null,
  colorHex: v?.colorHex ?? '',
  barcode: v?.barcode ?? '',
  active: v?.active ?? true,
});

/** A11 "Variantlar": table + inline editor; price/stock follow the MoySklad locks. */
export function VariantsTab({
  product,
  canEdit,
  action,
  lowStockDefault,
}: {
  product: AdminProductDto;
  canEdit: boolean;
  action: ProductAction;
  lowStockDefault: number;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { locks } = product;
  const listLocked = locks.source === 'moysklad';

  const move = (index: number, dir: -1 | 1) => {
    const ids = product.variants.map((v) => v.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void action.run('order', () =>
      adminFetch<AdminProductDto>(`/admin/products/${product.id}/variants/order`, {
        method: 'PUT',
        body: { ids },
      }),
    );
  };

  const remove = (v: AdminVariantDto) => {
    if (
      !window.confirm(
        `${v.sku} o'chirilsinmi? Sotilgan variantni o'chirib bo'lmaydi — o'chirib qo'ying.`,
      )
    )
      return;
    void action.run(`del-${v.id}`, () =>
      adminFetch<AdminProductDto>(`/admin/products/variants/${v.id}`, { method: 'DELETE' }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="px-1 py-2 font-normal">
                Variant
              </th>
              <th scope="col" className="px-1 py-2 font-normal">
                SKU · IKPU
              </th>
              <th scope="col" className="px-1 py-2 text-right font-normal">
                Narx
              </th>
              <th scope="col" className="px-1 py-2 text-right font-normal">
                Qoldiq
              </th>
              <th scope="col" className="px-1 py-2">
                <span className="sr-only">Amallar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v, i) => (
              <tr
                key={v.id}
                className={cn('border-b border-line-soft align-top', !v.active && 'opacity-55')}
                data-testid="variant-row"
              >
                <td className="px-1 py-3 font-semibold">{v.label.uz}</td>
                <td className="px-1 py-3">
                  <span className="block">{v.sku}</span>
                  <span
                    className={cn(
                      'text-[11px]',
                      v.ikpuMissing ? 'font-semibold text-critical' : 'text-muted',
                    )}
                  >
                    IKPU {v.ikpuMissing ? (v.ikpu ? `${v.ikpu} (namuna)` : "yo'q") : v.ikpu}
                  </span>
                </td>
                <td className="tabular px-1 py-3 text-right font-semibold whitespace-nowrap">
                  {soum(v.priceSoum)}
                  {v.compareAtSoum ? (
                    <span className="block text-[11px] font-normal text-muted line-through">
                      {soum(v.compareAtSoum)}
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    'tabular px-1 py-3 text-right font-semibold',
                    v.available === 0
                      ? 'text-critical'
                      : v.available < v.lowStockAt
                        ? 'text-warn'
                        : '',
                  )}
                  title={`Omborda ${v.stock}, band ${v.reserved}`}
                >
                  {v.available}
                </td>
                <td className="px-1 py-2 text-right">
                  {canEdit ? (
                    <span className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${v.sku}: yuqoriga`}
                        disabled={i === 0 || !!action.busy}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${v.sku}: pastga`}
                        disabled={i === product.variants.length - 1 || !!action.busy}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-expanded={editing === v.id}
                        onClick={() => setEditing(editing === v.id ? null : v.id)}
                        data-testid="variant-edit"
                      >
                        Tahrir
                      </Button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {locks.price ? COPY.priceLocked : COPY.ikpuNote} {locks.stock ? COPY.stockLocked : ''}{' '}
        {listLocked ? COPY.listLocked : ''}
      </p>

      {editing && editing !== 'new' ? (
        <VariantForm
          key={editing}
          product={product}
          variant={product.variants.find((v) => v.id === editing) ?? null}
          action={action}
          lowStockDefault={lowStockDefault}
          onDone={() => setEditing(null)}
          onDelete={listLocked ? undefined : remove}
        />
      ) : null}
      {canEdit && !listLocked ? (
        editing === 'new' ? (
          <VariantForm
            product={product}
            variant={null}
            action={action}
            lowStockDefault={lowStockDefault}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setEditing('new')}
            data-testid="variant-add"
          >
            + Variant
          </Button>
        )
      ) : null}
    </div>
  );
}

function VariantForm({
  product,
  variant,
  action,
  lowStockDefault,
  onDone,
  onDelete,
}: {
  product: AdminProductDto;
  variant: AdminVariantDto | null;
  action: ProductAction;
  lowStockDefault: number;
  onDone: () => void;
  onDelete?: (v: AdminVariantDto) => void;
}) {
  const [d, setD] = useState(() => draftOf(variant, lowStockDefault));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const { locks } = product;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = {
      sku: d.sku,
      label: d.label,
      ikpu: d.ikpu.trim(),
      packageCode: d.packageCode.trim(),
      vatPercent: d.vatPercent ?? 12,
      weightGrams: d.weightGrams,
      volumeMl: d.volumeMl,
      colorHex: d.colorHex.trim(),
      barcode: d.barcode.trim(),
      lowStockAt: d.lowStockAt ?? lowStockDefault,
      active: d.active,
      ...(locks.price ? {} : { priceSoum: d.priceSoum ?? 0, compareAtSoum: d.compareAtSoum }),
      ...(locks.stock ? {} : { stock: d.stock ?? 0 }),
    };
    const ok = await action.run(
      'variant',
      () =>
        variant
          ? adminFetch<AdminProductDto>(`/admin/products/variants/${variant.id}`, {
              method: 'PATCH',
              body,
            })
          : adminFetch<AdminProductDto>(`/admin/products/${product.id}/variants`, {
              method: 'POST',
              body,
            }),
      COPY.saved,
    );
    if (ok) onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md bg-off p-4"
      aria-label={variant ? `${variant.sku} variantini tahrirlash` : 'Yangi variant'}
      data-testid="variant-form"
    >
      <LocalizedInput
        label="Variant nomi"
        value={d.label}
        onChange={(v) => set('label', v)}
        required
        maxLength={60}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SKU">
          {(p) => (
            <Input
              {...p}
              className={compactInput}
              required
              value={d.sku}
              onChange={(e) => set('sku', e.target.value)}
            />
          )}
        </Field>
        <Field label="IKPU (MXIK)" hint="17 raqam">
          {(p) => (
            <Input
              {...p}
              className={compactInput}
              inputMode="numeric"
              pattern="\d{17}"
              value={d.ikpu}
              onChange={(e) => set('ikpu', e.target.value)}
              data-testid="variant-ikpu"
            />
          )}
        </Field>
        <Field label="Narx, so'm" hint={locks.price ? "MoySklad'dan" : undefined}>
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              required
              value={d.priceSoum}
              disabled={locks.price}
              onChange={(v) => set('priceSoum', v)}
              data-testid="variant-price"
            />
          )}
        </Field>
        <Field label="Eski narx (chizilgan), so'm">
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              value={d.compareAtSoum}
              disabled={locks.price}
              onChange={(v) => set('compareAtSoum', v)}
            />
          )}
        </Field>
        <Field
          label="Qoldiq"
          hint={locks.stock ? "MoySklad'dan" : variant ? `Band: ${variant.reserved}` : undefined}
        >
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              value={d.stock}
              disabled={locks.stock}
              onChange={(v) => set('stock', v)}
            />
          )}
        </Field>
        <Field label="Kam qoldiq chegarasi">
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              value={d.lowStockAt}
              onChange={(v) => set('lowStockAt', v)}
            />
          )}
        </Field>
        <Field label="Qadoq kodi">
          {(p) => (
            <Input
              {...p}
              className={compactInput}
              value={d.packageCode}
              onChange={(e) => set('packageCode', e.target.value)}
            />
          )}
        </Field>
        <Field label="QQS, %">
          {(p) => (
            <NumberInput
              {...p}
              min={0}
              value={d.vatPercent}
              onChange={(v) => set('vatPercent', v)}
            />
          )}
        </Field>
        <Field label="Og'irlik, g">
          {(p) => (
            <NumberInput
              {...p}
              min={1}
              value={d.weightGrams}
              onChange={(v) => set('weightGrams', v)}
            />
          )}
        </Field>
        <Field label="Hajm, ml">
          {(p) => (
            <NumberInput {...p} min={1} value={d.volumeMl} onChange={(v) => set('volumeMl', v)} />
          )}
        </Field>
        <Field label="Rang (#RRGGBB)">
          {(p) => (
            <span className="flex items-center gap-2">
              <Input
                {...p}
                className={compactInput}
                value={d.colorHex}
                pattern="#[0-9a-fA-F]{6}"
                onChange={(e) => set('colorHex', e.target.value)}
              />
              {/^#[0-9a-fA-F]{6}$/.test(d.colorHex) ? (
                <span
                  aria-hidden
                  className="size-8 shrink-0 rounded-full border border-line"
                  style={{ background: d.colorHex }}
                />
              ) : null}
            </span>
          )}
        </Field>
        <Field label="Shtrix-kod">
          {(p) => (
            <Input
              {...p}
              className={compactInput}
              value={d.barcode}
              onChange={(e) => set('barcode', e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="variant-active" checked={d.active} onCheckedChange={(v) => set('active', v)} />
        <label htmlFor="variant-active" className="font-semibold">
          Faol (saytda sotiladi)
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          loading={action.busy === 'variant'}
          data-testid="variant-save"
        >
          {COPY.save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Bekor qilish
        </Button>
        {variant && onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => onDelete(variant)}
          >
            O&apos;chirish
          </Button>
        ) : null}
      </div>
    </form>
  );
}
