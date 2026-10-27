'use client';

import {
  type AdminManualOrderResultDto,
  type AdminVariantOptionDto,
  TASHKENT_DISTRICTS,
  UZ_REGIONS,
} from '@forest/contracts/core';
import { Button, Panel } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { CARRIER_LABEL } from './copy';
import { TextAreaField, TextField } from './fields';

interface ZoneOption {
  key: string;
  name: string;
  carrier: 'YANDEX' | 'BTS' | 'PICKUP';
  priceSoum: number;
  freeFromSoum: number | null;
}

interface Line {
  variant: AdminVariantOptionDto;
  qty: number;
}

const NBSP = ' ';
const soum = (n: number) => `${n.toLocaleString('ru-RU').replace(/\s/g, NBSP)}${NBSP}so'm`;
const selectClass = 'h-[52px] w-full rounded-sm border border-line bg-panel px-3 text-[15px]';

/**
 * Phone order: the operator picks variants and the address; the API prices it exactly like the
 * storefront checkout (shipping, limits, stock) and the customer gets the usual SMS.
 * One Idempotency-Key per form, so a double submit can't create two orders.
 */
export function ManualOrderForm({ zones }: { zones: ZoneOption[] }) {
  const router = useRouter();
  const [key] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-order`,
  );
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<AdminVariantOptionDto[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [region, setRegion] = useState('tashkent_city');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      adminFetch<AdminVariantOptionDto[]>(`/admin/orders/variants?q=${encodeURIComponent(q)}`)
        .then((r) => alive && setOptions(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [q]);

  const add = (v: AdminVariantOptionDto) =>
    setLines((ls) =>
      ls.some((l) => l.variant.id === v.id)
        ? ls.map((l) => (l.variant.id === v.id ? { ...l, qty: Math.min(99, l.qty + 1) } : l))
        : [...ls, { variant: v, qty: 1 }],
    );
  const subtotal = lines.reduce((s, l) => s + l.variant.priceSoum * l.qty, 0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lines.length === 0) return setError("Kamida bitta mahsulot qo'shing.");
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await adminFetch<AdminManualOrderResultDto>('/admin/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          name: String(f.get('name') ?? ''),
          phone: String(f.get('phone') ?? ''),
          region,
          district: String(f.get('district') ?? '') || null,
          addressLine: String(f.get('addressLine') ?? ''),
          zoneKey: String(f.get('zoneKey') ?? ''),
          comment: String(f.get('comment') ?? '') || null,
          locale: String(f.get('locale') ?? 'uz'),
          lines: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty })),
        },
      });
      router.push(`/orders/${r.number}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]"
      aria-label="Qo'lda buyurtma"
    >
      <Panel as="section" className="flex flex-col gap-3 p-5 text-[13px] sm:p-6">
        <h2 className="text-xl font-semibold">Mahsulotlar</h2>
        <TextField
          label="Qidirish (nom yoki SKU)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chalk White, FR-CW…"
        />
        <ul
          className="flex max-h-[280px] flex-col overflow-y-auto"
          aria-label="Topilgan mahsulotlar"
        >
          {options.map((v) => (
            <li key={v.id} className="flex items-center gap-3 border-b border-line-soft py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="font-semibold">
                  {v.name} {v.label}
                </b>
                <span className="text-xs text-muted">
                  {v.sku} · {soum(v.priceSoum)} ·{' '}
                  {v.available > 0 ? `${v.available} dona bor` : "yo'q"}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={v.available <= 0}
                onClick={() => add(v)}
              >
                Qo&apos;shish
              </Button>
            </li>
          ))}
        </ul>
        <h3 className="pt-2 text-base font-semibold">Buyurtmada</h3>
        {lines.length === 0 ? (
          <p className="text-muted">Hali mahsulot tanlanmagan.</p>
        ) : (
          <ul className="flex flex-col" data-testid="manual-lines">
            {lines.map((l) => (
              <li
                key={l.variant.id}
                className="flex items-center gap-3 border-b border-line-soft py-2"
              >
                <span className="min-w-0 flex-1">
                  {l.variant.name} {l.variant.label}
                </span>
                <label className="flex items-center gap-1 text-xs">
                  <span className="sr-only">Soni</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(99, l.variant.available)}
                    value={l.qty}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x) =>
                          x.variant.id === l.variant.id
                            ? { ...x, qty: Math.max(1, Math.min(99, Number(e.target.value) || 1)) }
                            : x,
                        ),
                      )
                    }
                    className="h-9 w-16 rounded-xs border border-line px-2"
                  />
                </label>
                <b className="w-[110px] text-right">{soum(l.variant.priceSoum * l.qty)}</b>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLines((ls) => ls.filter((x) => x.variant.id !== l.variant.id))}
                >
                  O&apos;chirish
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-right text-base font-semibold">Mahsulotlar: {soum(subtotal)}</p>
        <p className="text-xs text-muted">
          Yetkazish narxi va jami buyurtma yaratilganda hisoblanadi.
        </p>
      </Panel>

      <Panel as="section" className="flex flex-col gap-3 p-5 text-[13px] sm:p-6">
        <h2 className="text-xl font-semibold">Mijoz va yetkazish</h2>
        <TextField
          label="Ism"
          name="name"
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
        <TextField
          label="Telefon"
          name="phone"
          required
          inputMode="tel"
          placeholder="90 123 45 67"
          autoComplete="off"
        />
        <label className="flex flex-col gap-1.5 font-semibold">
          Viloyat
          <select
            className={selectClass}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {UZ_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.uz}
              </option>
            ))}
          </select>
        </label>
        {region === 'tashkent_city' ? (
          <label className="flex flex-col gap-1.5 font-semibold">
            Tuman
            <select name="district" className={selectClass} defaultValue="">
              <option value="">—</option>
              {TASHKENT_DISTRICTS.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.uz}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <TextField label="Manzil" name="addressLine" required minLength={5} maxLength={300} />
        <label className="flex flex-col gap-1.5 font-semibold">
          Yetkazish zonasi
          <select name="zoneKey" className={selectClass} required>
            {zones.map((z) => (
              <option key={z.key} value={z.key}>
                {z.name} · {CARRIER_LABEL[z.carrier]} · {soum(z.priceSoum)}
                {z.freeFromSoum ? ` (${soum(z.freeFromSoum)} dan bepul)` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 font-semibold">
          SMS tili
          <select name="locale" className={selectClass} defaultValue="uz">
            <option value="uz">O&apos;zbekcha</option>
            <option value="ru">Ruscha</option>
          </select>
        </label>
        <TextAreaField
          label="Izoh (kuryer uchun)"
          name="comment"
          maxLength={500}
          className="min-h-20"
        />
        <p className="rounded-xs bg-off p-3 text-xs text-muted">
          To&apos;lov: naqd (kuryerga). Buyurtma «Yangi» holatida yaratiladi — keyin uni tasdiqlang.
        </p>
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy} block>
          Buyurtma yaratish
        </Button>
      </Panel>
    </form>
  );
}
