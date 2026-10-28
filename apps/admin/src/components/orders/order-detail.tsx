'use client';

import {
  type AdminOrderActionKey,
  type AdminOrderDetailDto,
  type AdminOrderPiiDto,
  type AdminPaymentDto,
  type AdminShipmentDto,
  type DeliveryStatus,
  formatTashkentDate,
  formatTashkentHm,
  refundableSoum,
} from '@forest/contracts/core';
import { Badge, Button, cn, Panel, Textarea } from '@forest/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { adminFetch, errorText } from '../../lib/client-api';
import { formatWhen, initials } from '../../lib/format';
import { CarrierLogo, OrderStatusBadge, PaymentCell } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { TextField } from './fields';
import {
  ACTION_LABEL,
  actorLabel,
  BLOCKED_HINT,
  CARRIER_LABEL,
  DELIVERY_STATUS_LABEL,
  eventText,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  SOURCE_LABEL,
  STEP_LABEL,
} from './copy';
import { SlaCountdown } from './sla-countdown';
import { slaDeadline, slaLeftShare } from './sla';

const NBSP = ' ';
const soum = (n: number) => `${n.toLocaleString('ru-RU').replace(/\s/g, NBSP)}${NBSP}so'm`;
const when = (iso: string) =>
  `${formatTashkentDate(new Date(iso))} ${formatTashkentHm(new Date(iso))}`;

/** Actions shown as plain buttons (no dialog), in fulfilment order. */
const DIRECT: readonly AdminOrderActionKey[] = [
  'confirm_cod',
  'cod_settled',
  'start_packing',
  'mark_ready',
  'yandex_create_claim',
  'yandex_refresh',
  'complete',
];
const PATH: Partial<Record<AdminOrderActionKey, string>> = {
  confirm_cod: '/confirm',
  cod_settled: '/cod-paid',
  start_packing: '/packing',
  mark_ready: '/ready',
  yandex_create_claim: '/yandex/claim',
  yandex_accept_claim: '/yandex/accept',
  yandex_refresh: '/yandex/refresh',
  yandex_mark_returned: '/yandex/returned',
  mark_delivered: '/delivered',
  complete: '/complete',
};
const BTS_STATUSES: DeliveryStatus[] = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_BRANCH',
  'DELIVERED',
  'FAILED',
  'RETURNED',
];

type Dialog =
  | 'cancel'
  | 'refund'
  | 'receipt'
  | 'bts'
  | 'yandex_accept'
  | 'yandex_cancel'
  | 'yandex_returned'
  | 'mark_delivered'
  | null;

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-key`;

/** A7 order detail (docs/08, design Admin-Buyurtma): every action comes from the API's list. */
export function OrderDetail({
  order,
  canCancelPaidClaim,
  journey,
}: {
  order: AdminOrderDetailDto;
  canCancelPaidClaim: boolean;
  journey?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pii, setPii] = useState<AdminOrderPiiDto | null>(null);
  const [refundKey, setRefundKey] = useState(newKey);
  const base = `/admin/orders/${order.number}`;
  const action = (key: AdminOrderActionKey) => order.actions.find((a) => a.key === key);
  const has = (key: AdminOrderActionKey) => Boolean(action(key));

  async function call(id: string, path: string, body?: unknown, headers?: Record<string, string>) {
    setBusy(id);
    setError(null);
    setDialogError(null);
    try {
      await adminFetch(`${base}${path}`, { method: 'POST', body: body ?? {}, headers });
      setDialog(null);
      router.refresh();
      return true;
    } catch (e) {
      if (dialog) setDialogError(errorText(e));
      else setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function reveal() {
    setBusy('pii');
    setError(null);
    try {
      setPii(await adminFetch<AdminOrderPiiDto>(`${base}/pii`, { method: 'POST', body: {} }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const open = (d: Dialog) => {
    setDialogError(null);
    if (d === 'refund') setRefundKey(newKey());
    setDialog(d);
  };

  const yandex = order.shipments.find((s) => s.carrier === 'YANDEX');
  const paid = order.payments.filter(
    (p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED',
  );
  const refundTarget = paid.find((p) => p.method !== 'PAYME') ?? paid[0];
  const confirmedAt = order.steps.find((s) => s.key === 'CONFIRMED')?.at ?? null;
  const cancel = action('cancel');

  return (
    <div className="flex flex-col gap-4" data-testid="order-detail">
      <header className="flex flex-wrap items-center gap-3 px-1 py-2">
        <div className="mr-auto flex flex-col gap-1">
          <nav aria-label="Yo'l" className="text-[13px] text-muted">
            <Link href="/orders" prefetch={false} className="underline underline-offset-2">
              Buyurtmalar
            </Link>{' '}
            / {order.number}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-medium tracking-[-0.035em] sm:text-[36px]">
              {order.number}
            </h1>
            <span data-testid="order-status">
              <OrderStatusBadge status={order.status} late={order.sla === 'LATE'} />
            </span>
            <span className="text-[13px] text-muted">
              {when(order.createdAt)} · {SOURCE_LABEL[order.source] ?? order.source}
            </span>
          </div>
        </div>
        {cancel ? (
          <Button
            variant="danger"
            disabled={Boolean(cancel.blockedBy)}
            title={cancel.blockedBy ? BLOCKED_HINT[cancel.blockedBy] : undefined}
            onClick={() => open('cancel')}
          >
            {ACTION_LABEL.cancel}
          </Button>
        ) : null}
      </header>

      {error ? (
        <Panel tone="critical" radius="md" role="alert" className="px-5 py-3 text-sm font-medium">
          {error}
        </Panel>
      ) : null}

      <Panel className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
        <ol className="flex flex-1 gap-1 overflow-x-auto pb-1" aria-label="Buyurtma bosqichlari">
          {order.steps.map((s, i) => (
            <li key={s.key} className="flex min-w-[96px] flex-1 flex-col gap-1.5">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs',
                    s.state === 'done' && 'border-forest bg-forest text-white',
                    s.state === 'current' && 'border-ink bg-ink text-white',
                    s.state === 'upcoming' && 'border-line bg-panel',
                  )}
                >
                  {s.state === 'upcoming' ? '' : '✓'}
                </span>
                {i < order.steps.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn('h-0.5 flex-1', s.state === 'done' ? 'bg-forest' : 'bg-line')}
                  />
                ) : null}
              </span>
              <b className="text-[13px] font-semibold">
                {STEP_LABEL[s.key]}
                <span className="sr-only">
                  {s.state === 'done' ? ' — bajarildi' : s.state === 'current' ? ' — hozir' : ''}
                </span>
              </b>
              <span className="text-xs text-muted">
                {s.at ? formatTashkentHm(new Date(s.at)) : '—'}
              </span>
            </li>
          ))}
        </ol>
        {order.slaDueAt && order.sla ? (
          <div
            className="flex w-full flex-col gap-2 rounded-sm bg-off p-4 text-xs lg:w-[340px]"
            data-testid="sla-box"
          >
            <span className="flex justify-between gap-2">
              <span className="text-muted">{order.zone.name} — muddat</span>
              <SlaCountdown dueAt={order.slaDueAt} serverNow={order.serverNow} />
            </span>
            <span className="h-1.5 overflow-hidden rounded-pill bg-line" aria-hidden>
              <span
                className={cn('block h-full', order.sla === 'OK' ? 'bg-forest' : 'bg-critical')}
                style={{
                  width: `${Math.round(slaLeftShare(confirmedAt, order.slaDueAt, new Date(order.serverNow)) * 100)}%`,
                }}
              />
            </span>
            <span className="text-muted">
              Muddat: {slaDeadline(order.slaDueAt, new Date(order.serverNow))}
            </span>
          </div>
        ) : null}
      </Panel>

      <ActionsPanel
        order={order}
        busy={busy}
        onDirect={(key) => call(key, PATH[key]!)}
        onDialog={open}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel as="section" className="flex flex-col p-5 text-[13px] sm:p-6">
            <h2 className="pb-2 text-xl font-semibold">Mahsulotlar</h2>
            <ul>
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 border-b border-line-soft py-3">
                  {i.image ? (
                    <img
                      src={i.image}
                      alt=""
                      width={52}
                      height={52}
                      className="size-[52px] rounded-xs object-cover"
                    />
                  ) : (
                    <span aria-hidden className="size-[52px] rounded-xs bg-canvas" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="font-semibold">{i.name}</b>
                    <span className="text-xs text-muted">
                      {[i.variantLabel, `SKU ${i.sku}`, `IKPU ${i.ikpu}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-muted">
                    ×{NBSP}
                    {i.qty}
                  </span>
                  <b className="w-[110px] text-right font-semibold">{soum(i.lineSoum)}</b>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 pt-3 text-muted">
              <dt>Mahsulotlar</dt>
              <dd className="text-right">{soum(order.totals.subtotalSoum)}</dd>
              {order.totals.discountSoum > 0 ? (
                <>
                  <dt>Chegirma{order.promoCode ? ` (${order.promoCode})` : ''}</dt>
                  <dd className="text-right">−{soum(order.totals.discountSoum)}</dd>
                </>
              ) : null}
              <dt>Yetkazish ({order.zone.name})</dt>
              <dd className="text-right">{soum(order.totals.shippingSoum)}</dd>
              <dt className="font-semibold text-ink">Jami</dt>
              <dd className="text-right text-xl font-semibold text-ink" data-testid="order-total">
                {soum(order.totals.totalSoum)}
              </dd>
            </dl>
            {order.comment ? (
              <p className="mt-3 rounded-xs bg-off p-3 text-xs">Mijoz izohi: {order.comment}</p>
            ) : null}
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <PaymentPanel
              order={order}
              refundBlocked={action('refund')?.blockedBy ?? null}
              canRefund={has('refund')}
              onRefund={() => open('refund')}
            />
            <DeliveryPanel
              order={order}
              shipment={order.shipments.find((s) => s.carrier === order.carrier) ?? yandex ?? null}
              pii={pii}
              canReveal={has('reveal_pii')}
              revealing={busy === 'pii'}
              onReveal={reveal}
            />
          </div>

          <Timeline
            order={order}
            canNote={has('add_note')}
            onNote={(text) => call('note', '/notes', { text })}
            busy={busy === 'note'}
          />
        </div>

        <aside className="flex flex-col gap-4">
          {order.customer ? (
            <Panel tone="dark" className="flex items-center gap-3 p-5">
              <span
                aria-hidden
                className="grid size-12 shrink-0 place-items-center rounded-full bg-forest text-lg font-semibold"
              >
                {initials(order.customer.name ?? order.contact.name)}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <b className="truncate text-lg font-semibold">
                  {order.customer.name ?? order.contact.name}
                </b>
                <span className="text-[13px] text-on-dark-muted" data-testid="customer-card">
                  {order.customer.publicId} · {order.customer.nth}-xarid ·{' '}
                  {order.customer.ordersCount} ta buyurtma · LTV {soum(order.customer.ltvSoum)}
                </span>
                {order.customer.tags.length ? (
                  <span className="flex flex-wrap gap-1 pt-1">
                    {order.customer.tags.map((t) => (
                      <Badge key={t} tone="sage">
                        {t}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </span>
            </Panel>
          ) : null}

          <Panel as="section" className="flex flex-col gap-2 p-5 text-[13px]">
            <h2 className="text-lg font-semibold">Fiskal chek</h2>
            {order.fiscal.receipt ? (
              <p data-testid="fiscal-receipt">
                {order.fiscal.receipt.receiptNumber
                  ? `№ ${order.fiscal.receipt.receiptNumber}`
                  : null}
                {order.fiscal.receipt.url ? (
                  <>
                    {' '}
                    <a
                      href={order.fiscal.receipt.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      chekni ochish
                    </a>
                  </>
                ) : null}
                <span className="block text-xs text-muted">
                  {formatWhen(order.fiscal.receipt.createdAt)}
                </span>
              </p>
            ) : order.fiscal.evidence ? (
              <p>
                To&apos;lov tizimi chek berdi (
                {order.fiscal.evidence === 'payme_detail' ? 'Payme' : 'havola'}).
              </p>
            ) : (
              <p className="text-muted">
                Chek hali kiritilmagan. Buyurtmani yakunlash uchun chek kerak (naqd: kuryer
                kassasidan).
              </p>
            )}
            {has('record_receipt') ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => open('receipt')}
              >
                {order.fiscal.receipt ? 'Chekni tuzatish' : ACTION_LABEL.record_receipt}
              </Button>
            ) : null}
          </Panel>

          {/* A7 order journey (Phase 4): rendered by the page when the role has analytics. */}
          {journey}
        </aside>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`${order.number} ni bekor qilish`}
        confirmLabel="Bekor qilish"
        tone="danger"
        busy={busy === 'cancel'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={(f) => call('cancel', '/cancel', { reason: String(f.get('reason') ?? '') })}
      >
        <p className="text-muted">
          Zaxira bo&apos;shatiladi, to&apos;lanmagan to&apos;lov urinishlari yopiladi. Mijozga SMS
          yuborilmaydi — kerak bo&apos;lsa qo&apos;ng&apos;iroq qiling.
        </p>
        <TextField
          label="Sabab"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Mijoz rad etdi"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'refund'}
        title="Pulni qaytarish"
        confirmLabel="Qaytarishni yozish"
        tone="danger"
        busy={busy === 'refund'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={(f) =>
          call(
            'refund',
            '/refunds',
            {
              paymentId: String(f.get('paymentId')),
              amountSoum: Number(String(f.get('amount') ?? '').replace(/\D/g, '')),
              reason: String(f.get('reason') ?? ''),
            },
            { 'Idempotency-Key': refundKey },
          )
        }
      >
        {refundTarget ? (
          <>
            <input type="hidden" name="paymentId" value={refundTarget.id} />
            <p className="text-muted">
              {PAYMENT_METHOD_LABEL[refundTarget.method]}: {soum(refundTarget.amountSoum)},
              qaytarilgan {soum(refundTarget.refundedSoum)}.{' '}
              {refundTarget.method === 'CLICK'
                ? 'Pulni Click kabinetida qaytaring, keyin shu yerda yozing.'
                : 'Naqd pulni mijozga qaytaring, keyin shu yerda yozing.'}{' '}
              To&apos;liq qaytarish jo&apos;natilmagan buyurtmani bekor qiladi.
            </p>
            <TextField
              label={<>Summa (so&apos;m)</>}
              name="amount"
              inputMode="numeric"
              required
              defaultValue={String(refundableSoum(refundTarget))}
            />
            <TextField label="Sabab" name="reason" required minLength={3} maxLength={300} />
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'receipt'}
        title="Fiskal chek"
        confirmLabel="Saqlash"
        busy={busy === 'receipt'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={(f) =>
          call('receipt', '/receipt', {
            receiptNumber: String(f.get('receiptNumber') ?? '') || null,
            receiptUrl: String(f.get('receiptUrl') ?? '') || null,
          })
        }
      >
        <p className="text-muted">Kassadan (OFD) chek raqami yoki havolasini kiriting.</p>
        <TextField
          label="Chek raqami"
          name="receiptNumber"
          maxLength={64}
          defaultValue={order.fiscal.receipt?.receiptNumber ?? ''}
        />
        <TextField
          label="Chek havolasi (https)"
          name="receiptUrl"
          type="url"
          maxLength={500}
          defaultValue={order.fiscal.receipt?.url ?? ''}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'bts'}
        title="BTS: yuk holati"
        confirmLabel="Saqlash"
        busy={busy === 'bts'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={(f) =>
          call('bts', '/bts', {
            status: String(f.get('status')),
            trackNumber: String(f.get('trackNumber') ?? '') || null,
            branch: String(f.get('branch') ?? '') || null,
            note: String(f.get('note') ?? '') || null,
          })
        }
      >
        <BtsFields shipment={order.shipments.find((s) => s.carrier === 'BTS') ?? null} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'yandex_accept'}
        title="Yandex kuryerini chaqirish"
        confirmLabel="Ha, kuryer chaqirilsin"
        busy={busy === 'yandex_accept'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() => call('yandex_accept', PATH.yandex_accept_claim!)}
      >
        <p className="text-muted">
          Haqiqiy kuryer yo&apos;lga chiqadi va xizmat pullik. Buyurtma yig&apos;ilgan va
          topshirishga tayyor ekanini tekshiring.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'yandex_cancel'}
        title="Yandex kuryerini bekor qilish"
        confirmLabel="Bekor qilish"
        tone="danger"
        busy={busy === 'yandex_cancel'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={(f) =>
          call('yandex_cancel', '/yandex/cancel', { allowPaid: f.get('allowPaid') === 'on' })
        }
      >
        <p className="text-muted">
          Kuryer yo&apos;lga chiqqan bo&apos;lsa, bekor qilish pullik bo&apos;lishi mumkin — avval
          bepul bekor qilishga urinamiz.
        </p>
        {canCancelPaidClaim ? (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="allowPaid" className="size-4" />
            Pullik bekor qilishga roziman
          </label>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'yandex_returned'}
        title="Posilka omborga qaytdimi?"
        confirmLabel="Ha, qaytdi"
        busy={busy === 'yandex_returned'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() => call('yandex_returned', PATH.yandex_mark_returned!)}
      >
        <p className="text-muted">
          Buyurtma «Qaytarildi» bo&apos;ladi va zaxira bo&apos;shatiladi.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'mark_delivered'}
        title="Mijoz buyurtmani olib ketdimi?"
        confirmLabel="Ha, topshirildi"
        busy={busy === 'mark_delivered'}
        error={dialogError}
        onClose={() => setDialog(null)}
        onConfirm={() => call('mark_delivered', PATH.mark_delivered!)}
      />
    </div>
  );
}

function ActionsPanel({
  order,
  busy,
  onDirect,
  onDialog,
}: {
  order: AdminOrderDetailDto;
  busy: string | null;
  onDirect: (key: AdminOrderActionKey) => void;
  onDialog: (d: Dialog) => void;
}) {
  const dialogFor: Partial<Record<AdminOrderActionKey, Dialog>> = {
    yandex_accept_claim: 'yandex_accept',
    yandex_cancel_claim: 'yandex_cancel',
    yandex_mark_returned: 'yandex_returned',
    bts_update: 'bts',
    mark_delivered: 'mark_delivered',
  };
  const shown = order.actions.filter((a) => DIRECT.includes(a.key) || dialogFor[a.key]);
  if (shown.length === 0) return null;
  const primary = shown.find(
    (a) => !a.blockedBy && a.key !== 'yandex_refresh' && a.key !== 'yandex_cancel_claim',
  );
  return (
    <Panel as="section" aria-label="Amallar" className="flex flex-col gap-2 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <Button
            key={a.key}
            data-testid={`action-${a.key}`}
            variant={
              a === primary ? 'primary' : a.key === 'yandex_cancel_claim' ? 'danger' : 'outline'
            }
            disabled={Boolean(a.blockedBy) || (busy !== null && busy !== a.key)}
            loading={busy === a.key}
            title={a.blockedBy ? BLOCKED_HINT[a.blockedBy] : undefined}
            onClick={() => {
              const d = dialogFor[a.key];
              if (d) onDialog(d);
              else onDirect(a.key);
            }}
          >
            {ACTION_LABEL[a.key]}
          </Button>
        ))}
      </div>
      {shown
        .filter((a) => a.blockedBy)
        .map((a) => (
          <p key={a.key} className="text-xs text-muted">
            {ACTION_LABEL[a.key]}: {a.blockedBy ? (BLOCKED_HINT[a.blockedBy] ?? a.blockedBy) : null}
          </p>
        ))}
      {order.carrier === 'YANDEX' && order.actions.some((a) => a.key === 'yandex_create_claim') ? (
        <p className="text-xs text-muted">
          Kuryer ikki bosqichda chaqiriladi: avval Yandex narxni hisoblaydi, keyin «Kuryer
          chaqirish» bilan tasdiqlaysiz.
        </p>
      ) : null}
    </Panel>
  );
}

function PaymentPanel({
  order,
  canRefund,
  refundBlocked,
  onRefund,
}: {
  order: AdminOrderDetailDto;
  canRefund: boolean;
  refundBlocked: string | null;
  onRefund: () => void;
}) {
  const shown: AdminPaymentDto | undefined =
    order.payments.find((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)) ??
    order.payments.at(-1);
  return (
    <Panel as="section" className="flex flex-col gap-2 p-5 text-[13px]" data-testid="payment-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="sr-only">To&apos;lov</h2>
        <PaymentCell method={order.paymentMethod} status={null} />
        {order.paymentStatus ? (
          <Badge tone={order.paymentStatus === 'PAID' ? 'good' : 'warn'}>
            {PAYMENT_STATUS_LABEL[order.paymentStatus]}
          </Badge>
        ) : null}
      </div>
      {shown ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted">Tranzaksiya</dt>
          <dd
            className="truncate text-right font-semibold"
            title={shown.providerTxnId ?? undefined}
          >
            {shown.providerTxnId ?? '—'}
          </dd>
          <dt className="text-muted">Vaqt</dt>
          <dd className="text-right font-semibold">
            {shown.performedAt ? when(shown.performedAt) : when(shown.createdAt)}
          </dd>
          <dt className="text-muted">Karta</dt>
          <dd className="text-right text-muted">saqlanmaydi</dd>
          {shown.refunds.map((r) => (
            <div key={r.id} className="col-span-2 flex justify-between rounded-xs bg-off px-2 py-1">
              <span>
                Qaytarildi · {r.by} · {formatWhen(r.createdAt)}
              </span>
              <b>{soum(r.amountSoum)}</b>
            </div>
          ))}
        </dl>
      ) : null}
      {order.payments.length > 1 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            Barcha urinishlar ({order.payments.length})
          </summary>
          <ul className="mt-1 text-xs">
            {order.payments.map((p) => (
              <li key={p.id}>
                {PAYMENT_METHOD_LABEL[p.method]} · {PAYMENT_STATUS_LABEL[p.status]} ·{' '}
                {when(p.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canRefund ? (
        refundBlocked ? (
          <p className="rounded-xs bg-warn-bg p-2 text-xs text-warn" data-testid="refund-hint">
            {BLOCKED_HINT[refundBlocked] ?? refundBlocked}
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={onRefund}
            data-testid="action-refund"
          >
            {ACTION_LABEL.refund}
          </Button>
        )
      ) : null}
    </Panel>
  );
}

function DeliveryPanel({
  order,
  shipment,
  pii,
  canReveal,
  revealing,
  onReveal,
}: {
  order: AdminOrderDetailDto;
  shipment: AdminShipmentDto | null;
  pii: AdminOrderPiiDto | null;
  canReveal: boolean;
  revealing: boolean;
  onReveal: () => void;
}) {
  return (
    <Panel
      as="section"
      className="flex flex-col gap-2 p-5 text-[13px]"
      data-testid="delivery-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="sr-only">Yetkazish</h2>
        <CarrierLogo carrier={order.carrier} />
        <Badge tone="neutral">
          {shipment ? DELIVERY_STATUS_LABEL[shipment.status] : CARRIER_LABEL[order.carrier]}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">Manzil</dt>
        <dd className="text-right font-semibold" data-testid="delivery-address">
          {pii?.address
            ? [pii.address.region, pii.address.district, pii.address.line]
                .filter(Boolean)
                .join(', ')
            : [order.contact.region, order.contact.district].filter(Boolean).join(', ')}
        </dd>
        <dt className="text-muted">Qabul qiluvchi</dt>
        <dd className="text-right font-semibold" data-testid="delivery-phone">
          {order.contact.name} ·{' '}
          {pii?.phone ? (
            <a href={`tel:${pii.phone.replace(/\s/g, '')}`} className="underline">
              {pii.phone}
            </a>
          ) : (
            order.contact.phoneMasked
          )}
        </dd>
        {shipment?.trackNumber ? (
          <>
            <dt className="text-muted">Trek</dt>
            <dd className="text-right font-semibold">{shipment.trackNumber}</dd>
          </>
        ) : null}
        {shipment?.branch ? (
          <>
            <dt className="text-muted">Filial</dt>
            <dd className="text-right">{shipment.branch}</dd>
          </>
        ) : null}
        {shipment?.carrier === 'YANDEX' && shipment.externalId ? (
          <>
            <dt className="text-muted">Yandex</dt>
            <dd className="truncate text-right" title={shipment.externalId}>
              {shipment.providerStatus ?? '—'}
              {shipment.acceptedAt
                ? ' · tasdiqlangan'
                : shipment.acceptPending
                  ? ' · tasdiqlanmoqda'
                  : ''}
            </dd>
          </>
        ) : null}
        {shipment?.courier ? (
          <>
            <dt className="text-muted">Kuryer</dt>
            <dd className="text-right">
              {[
                shipment.courier.name,
                shipment.courier.car,
                shipment.courier.plate,
                shipment.courier.phoneMasked,
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </>
        ) : null}
      </dl>
      {canReveal && !pii ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={onReveal}
          loading={revealing}
          data-testid="reveal-pii"
        >
          {ACTION_LABEL.reveal_pii}
        </Button>
      ) : null}
      {canReveal ? (
        <p className="text-xs text-muted">
          To&apos;liq ma&apos;lumotni ko&apos;rish faoliyat jurnaliga yoziladi.
        </p>
      ) : null}
      {shipment && shipment.history.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            Yetkazish tarixi ({shipment.history.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {shipment.history.map((h, i) => (
              <li key={i}>
                {formatWhen(h.at)} · {DELIVERY_STATUS_LABEL[h.status]}
                {h.place ? ` · ${h.place}` : ''}
                {h.note ? ` · ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

function BtsFields({ shipment }: { shipment: AdminShipmentDto | null }) {
  const statusId = useId();
  const current = shipment?.status ?? 'NOT_CREATED';
  const options = BTS_STATUSES.filter((s) => s !== current);
  return (
    <>
      <p className="text-muted">
        Hozir: {DELIVERY_STATUS_LABEL[current]}. BTS API yo&apos;q — holatni BTS kabinetidan
        ko&apos;rib kiriting; mijozga mos SMS avtomatik ketadi.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={statusId} className="text-[13px] font-semibold">
          Holat
        </label>
        <select
          id={statusId}
          name="status"
          defaultValue={options[0]}
          className="h-11 rounded-sm border border-line bg-panel px-3 text-sm"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {DELIVERY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="Yuk xati (trek) raqami"
        name="trackNumber"
        maxLength={40}
        defaultValue={shipment?.trackNumber ?? ''}
      />
      <TextField
        label="Filial (ixtiyoriy)"
        name="branch"
        maxLength={200}
        defaultValue={shipment?.branch ?? ''}
      />
      <TextField label="Izoh (ixtiyoriy)" name="note" maxLength={300} />
    </>
  );
}

function Timeline({
  order,
  canNote,
  onNote,
  busy,
}: {
  order: AdminOrderDetailDto;
  canNote: boolean;
  onNote: (text: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await onNote(text.trim())) setText('');
  }
  return (
    <Panel as="section" className="flex flex-col p-5 text-[13px] sm:p-6">
      <h2 className="pb-2 text-xl font-semibold">Tizim jurnali</h2>
      <ol data-testid="order-timeline">
        {order.timeline.map((e) => (
          <li
            key={e.id}
            className={cn(
              'grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-line-soft py-2.5',
              e.type === 'NOTE' && 'bg-sage-50',
            )}
          >
            <time dateTime={e.at} className="text-muted">
              {formatWhen(e.at)}
            </time>
            <span>
              {eventText(e)}
              {e.note ? (
                <span className="block whitespace-pre-wrap text-ink-2">«{e.note}»</span>
              ) : null}
              <span className="block text-xs text-muted">{actorLabel(e)}</span>
            </span>
          </li>
        ))}
      </ol>
      {canNote ? (
        <form
          onSubmit={submit}
          className="flex flex-col gap-2 pt-3 sm:flex-row"
          aria-label="Ichki izoh"
        >
          <Textarea
            aria-label="Ichki izoh"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder="Ichki izoh qo'shish (mijoz ko'rmaydi)"
            className="min-h-[52px] flex-1"
          />
          <Button type="submit" loading={busy} disabled={!text.trim()}>
            Saqlash
          </Button>
        </form>
      ) : null}
    </Panel>
  );
}
