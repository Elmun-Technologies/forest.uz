'use client';

import type { CustomerNoteDto, CustomerPiiDto } from '@forest/contracts/core';
import { Button, cn } from '@forest/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminDownload, adminFetch, errorText } from '../../lib/client-api';
import { formatWhen } from '../../lib/format';
import { FormError } from '../auth-card';
import { ConfirmDialog } from './confirm-dialog';
import { regionLabel } from './copy';

/** "Ko'rsatish": full phone, Telegram and addresses — the API logs `customer.view_pii`. */
export function RevealPii({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerPiiDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      setData(
        await adminFetch<CustomerPiiDto>(`/admin/customers/${customerId}/reveal`, {
          method: 'POST',
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <span className="flex flex-col items-start gap-1">
        <Button variant="inverse" size="sm" onClick={() => void reveal()} loading={busy}>
          Raqam va manzilni ko&apos;rsatish
        </Button>
        <span className="text-[11px] text-on-dark-muted">
          Ko&apos;rish faoliyat jurnaliga yoziladi
        </span>
        {error ? (
          <span role="alert" className="text-xs text-[#F3B7AE]">
            {error}
          </span>
        ) : null}
      </span>
    );
  return (
    <div
      className="flex flex-col gap-1 rounded-sm bg-dark-2 px-4 py-3 text-[13px]"
      data-testid="customer-pii"
    >
      <span>
        <span className="text-on-dark-muted">Telefon: </span>
        {data.phone ? (
          <a
            href={`tel:${data.phone.replace(/\s/g, '')}`}
            className="font-semibold text-white underline"
          >
            {data.phone}
          </a>
        ) : (
          '—'
        )}
      </span>
      {data.telegramUsername ? (
        <span>
          <span className="text-on-dark-muted">Telegram: </span>@{data.telegramUsername}
        </span>
      ) : null}
      {data.addresses.map((a) => (
        <span key={a.id}>
          <span className="text-on-dark-muted">
            {a.label ?? (a.isDefault ? 'Asosiy manzil' : 'Manzil')}:{' '}
          </span>
          {regionLabel(a.region)}
          {a.district ? `, ${a.district}` : ''}, {a.line}
        </span>
      ))}
      {data.addresses.length === 0 ? (
        <span className="text-on-dark-muted">Saqlangan manzil yo&apos;q</span>
      ) : null}
    </div>
  );
}

/** Tags chips + inline editor (audited server-side). */
export function TagsEditor({
  customerId,
  tags,
  editable,
}: {
  customerId: string;
  tags: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/customers/${customerId}/tags`, {
        method: 'PUT',
        body: { tags: next },
      });
      setValue('');
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const extra = value
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
    if (extra.length) void save([...tags, ...extra]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="customer-tags">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-pill border border-dark-3 px-2.5 py-1 text-xs"
        >
          #{t}
          {editable ? (
            <button
              type="button"
              aria-label={`#${t} tegini olib tashlash`}
              disabled={busy}
              onClick={() => void save(tags.filter((x) => x !== t))}
              className="text-on-dark-muted hover:text-white"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {editable && !editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-pill border border-dashed border-dark-3 px-2.5 py-1 text-xs text-on-dark-muted hover:text-white"
        >
          + teg
        </button>
      ) : null}
      {editing ? (
        <form onSubmit={add} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="new-tag">
            Yangi teg
          </label>
          <input
            id="new-tag"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="divan, vip"
            className="h-8 w-36 rounded-pill bg-dark-2 px-3 text-xs text-white placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-sage"
          />
          <Button size="sm" variant="inverse" type="submit" loading={busy}>
            Saqlash
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-on-dark-muted"
          >
            Bekor
          </button>
        </form>
      ) : null}
      {error ? (
        <span role="alert" className="w-full text-xs text-[#F3B7AE]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Staff-only notes (CustomerNote); the audit keeps the fact, not the text. */
export function NotesPanel({
  customerId,
  notes,
  editable,
}: {
  customerId: string;
  notes: CustomerNoteDto[];
  editable: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/customers/${customerId}/notes`, { method: 'POST', body: { text } });
      setText('');
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {editable ? (
        <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Izoh qo'shish">
          <label className="sr-only" htmlFor="customer-note">
            Ichki izoh
          </label>
          <textarea
            id="customer-note"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Faqat xodimlar ko'radi: qo'ng'iroq natijasi, mijoz istagi…"
            className="min-h-20 rounded-sm border border-line bg-panel px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
          />
          <FormError message={error} />
          <span>
            <Button size="sm" type="submit" loading={busy} disabled={!text.trim()}>
              Izoh qo&apos;shish
            </Button>
          </span>
        </form>
      ) : null}
      {notes.length === 0 ? <p className="text-muted">Izohlar yo&apos;q.</p> : null}
      <ul className="flex flex-col">
        {notes.map((n) => (
          <li key={n.id} className="border-t border-line-soft py-2">
            <span className="text-xs text-muted">
              {formatWhen(n.createdAt)} · {n.staffName ?? '—'}
            </span>
            <p className="whitespace-pre-wrap">{n.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A5 "Ma'lumotlarni yuklab olish" + "O'chirish" (Owner; erase needs the typed C-… id). */
export function DataActions({
  customerId,
  publicId,
  canExport,
  canErase,
  openOrders,
}: {
  customerId: string;
  publicId: string;
  canExport: boolean;
  canErase: boolean;
  openOrders: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'export' | 'erase' | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function exportData() {
    setBusy('export');
    setError(null);
    try {
      await adminDownload(`/admin/customers/${customerId}/export`, {}, `${publicId}.json`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    setBusy('erase');
    setError(null);
    try {
      await adminFetch(`/admin/customers/${customerId}/erase`, {
        method: 'POST',
        body: { confirm: publicId },
      });
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!canExport && !canErase) return null;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-wrap gap-2">
        {canExport ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportData()}
            loading={busy === 'export'}
          >
            Ma&apos;lumotlarni yuklab olish
          </Button>
        ) : null}
        {canErase ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={openOrders > 0}
            title={openOrders > 0 ? 'Yakunlanmagan buyurtma bor' : undefined}
          >
            O&apos;chirish
          </Button>
        ) : null}
      </div>
      {canErase && openOrders > 0 ? (
        <p className="text-xs text-muted">
          {openOrders} ta yakunlanmagan buyurtma bor — yopilgach o&apos;chirish mumkin.
        </p>
      ) : null}
      {!confirming ? <FormError message={error} /> : null}
      <ConfirmDialog
        open={confirming}
        title="Mijoz ma'lumotlarini o'chirish"
        confirmLabel="Butunlay o'chirish"
        typed={publicId}
        danger
        busy={busy === 'erase'}
        error={error}
        onConfirm={() => void erase()}
        onClose={() => setConfirming(false)}
      >
        <p>
          Ism, telefon, Telegram, manzillar, izohlar va savat o&apos;chiriladi; xabar matnlari
          tozalanadi; marketing roziliklari bekor qilinadi.
        </p>
        <p className={cn('rounded-sm bg-warn-bg px-3 py-2 text-warn')}>
          Buyurtmalar, to&apos;lovlar va fiskal cheklar qonun bo&apos;yicha saqlanadi — kontakt
          ma&apos;lumotlarisiz. Bu amalni qaytarib bo&apos;lmaydi.
        </p>
      </ConfirmDialog>
    </div>
  );
}
