import { Injectable, Logger } from '@nestjs/common';
import { DomainError, t } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { maskPhonesInText } from '../common/redact';
import { OrderLifecycleService, orderAllowsRefund } from '../commerce/order-lifecycle.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  buildPaymeReceiptDetail,
  isPaymeAuthorized,
  isPaymeCreateTimeTooOld,
  isPaymeTxnExpired,
  PAYME_ACCOUNT_FIELD,
  paymeAuthKey,
  PaymeError,
  paymeKeyField,
  type PaymeMessage,
  type PaymeReceiptDetail,
  PaymeReason,
  PaymeState,
} from '../integrations/providers/payme';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type RpcId = string | number | null;
type Params = Record<string, unknown>;

export type PaymeRpcResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: unknown; error: null }
  | {
      jsonrpc: '2.0';
      id: RpcId;
      result: null;
      error: { code: number; message: PaymeMessage; data?: string };
    };

const msg = (en: string, ru: string, uz: string): PaymeMessage => ({ ru, uz, en });

/** Messages: English text from the official template, ru/uz translations ours. */
const M = {
  privilege: msg(
    'Insufficient privilege to perform this method.',
    'Недостаточно привилегий для выполнения метода.',
    'Usulni bajarish uchun huquq yetarli emas.',
  ),
  invalidRpc: msg(
    'Invalid JSON-RPC object.',
    'Неверный объект JSON-RPC.',
    "JSON-RPC obyekti noto'g'ri.",
  ),
  methodNotFound: msg('Method not found.', 'Метод не найден.', 'Usul topilmadi.'),
  amount: msg('Incorrect amount.', 'Неверная сумма.', "Summa noto'g'ri."),
  // Template's own trilingual message for a missing/unknown account.
  orderCode: msg('Incorrect order code.', 'Неверный код заказа.', 'Harid kodida xatolik.'),
  alreadyPaid: msg(
    'Order state is invalid: the order is already paid.',
    'Неверное состояние заказа: заказ уже оплачен.',
    "Buyurtma holati noto'g'ri: buyurtma allaqachon to'langan.",
  ),
  notPayable: msg(
    'Order state is invalid: the order is cancelled or its payment time is over.',
    'Неверное состояние заказа: заказ отменён или время оплаты истекло.',
    "Buyurtma holati noto'g'ri: buyurtma bekor qilingan yoki to'lov muddati tugagan.",
  ),
  otherTxn: msg(
    'There is other active/completed transaction for this order.',
    'Для этого заказа есть другая активная/завершённая транзакция.',
    'Bu buyurtma uchun boshqa faol/yakunlangan tranzaksiya bor.',
  ),
  txnNotFound: msg('Transaction not found.', 'Транзакция не найдена.', 'Tranzaksiya topilmadi.'),
  txnNotActive: msg(
    'Transaction found, but is not active.',
    'Транзакция найдена, но не активна.',
    'Tranzaksiya topildi, lekin faol emas.',
  ),
  txnExpired: msg(
    'Transaction is expired.',
    'Срок транзакции истёк.',
    "Tranzaksiya muddati o'tgan.",
  ),
  couldNotPerform: msg(
    'Could not perform this operation.',
    'Невозможно выполнить данную операцию.',
    "Bu amalni bajarib bo'lmaydi.",
  ),
  couldNotCancel: msg(
    'Could not cancel transaction. Order is delivered/Service is completed.',
    'Невозможно отменить транзакцию: заказ передан курьеру или доставлен.',
    "Tranzaksiyani bekor qilib bo'lmaydi: buyurtma kuryerga topshirilgan yoki yetkazilgan.",
  ),
  createTimeout: msg(
    'Since create time of the transaction passed 43200000ms',
    'С даты создания транзакции прошло 43200000мс',
    'Tranzaksiya yaratilgan sanadan 43200000ms o`tgan',
  ),
  period: msg('Incorrect period.', 'Неверный период.', "Davr noto'g'ri."),
  passwordMissing: msg(
    'New password not specified.',
    'Новый пароль не указан.',
    "Yangi parol ko'rsatilmagan.",
  ),
  passwordSame: msg(
    'Insufficient privilege. Incorrect new password.',
    'Недостаточно привилегий. Неверный новый пароль.',
    "Huquq yetarli emas. Yangi parol noto'g'ri.",
  ),
  internal: msg('Internal System Error.', 'Внутренняя ошибка системы.', 'Tizimning ichki xatosi.'),
};

export class PaymeRpcError extends Error {
  constructor(
    readonly code: number,
    readonly rpcMessage: PaymeMessage,
    readonly data?: string,
  ) {
    super(`payme ${code}`);
  }
}

const PROVIDER = { type: 'PAYMENT_PROVIDER' as const, id: 'payme' };

interface PaymeTxnData {
  /** Payme's own transaction time (ms), echoed in GetStatement. */
  time: number;
  /** When we created the transaction (ms) — basis of the 12 h timeout. */
  createTime: number;
}

const orderInclude = {
  items: true,
  payments: { orderBy: { createdAt: 'desc' } },
  reservations: { where: { releasedAt: null } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type PaymentRow = Prisma.PaymentGetPayload<object>;

/**
 * Payme Merchant API (JSON-RPC 2.0) — PaycomUZ/paycom-integration-php-template `Application.php`
 * semantics, mapped onto our Payment rows (one row per Payme transaction, see CLAUDE.md).
 * Every state change goes through OrderLifecycleService under order → payment row locks, so
 * duplicate or concurrent calls are serialized and never double-pay.
 */
@Injectable()
export class PaymeMerchantService {
  private readonly logger = new Logger('PaymeMerchant');
  /** Overridable in tests (fixed clock). */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly integrations: IntegrationsService,
  ) {}

  async handle(
    body: unknown,
    authorization: string | undefined,
    ip: string | null,
  ): Promise<PaymeRpcResponse> {
    const req = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const id = req && (typeof req.id === 'number' || typeof req.id === 'string') ? req.id : null;
    const method = typeof req?.method === 'string' ? req.method.trim() : '';
    try {
      // Template order: authorize first (even a malformed body gets -32504 without the key).
      const credentials = await this.integrations.connectedCredentials('payme');
      if (
        !credentials ||
        !isPaymeAuthorized(authorization, paymeAuthKey(credentials)) ||
        !ipAllowed(credentials.allowedIps, ip)
      )
        throw new PaymeRpcError(PaymeError.INSUFFICIENT_PRIVILEGE, M.privilege);
      if (!req || !method)
        throw new PaymeRpcError(PaymeError.INVALID_JSON_RPC_OBJECT, M.invalidRpc);
      const params = (req.params && typeof req.params === 'object' ? req.params : {}) as Params;
      const result = await this.dispatch(method, params, credentials);
      this.audit(method, true, 'ok', params);
      return { jsonrpc: '2.0', id, result, error: null };
    } catch (e) {
      const err =
        e instanceof PaymeRpcError ? e : new PaymeRpcError(PaymeError.INTERNAL_SYSTEM, M.internal);
      if (!(e instanceof PaymeRpcError))
        this.logger.error(
          maskPhonesInText(e instanceof Error ? (e.stack ?? e.message) : String(e)),
        );
      // Unauthenticated calls are not logged as provider traffic (anyone can hit the URL).
      if (err.code !== PaymeError.INSUFFICIENT_PRIVILEGE)
        this.audit(method || 'unknown', false, String(err.code), req?.params);
      return {
        jsonrpc: '2.0',
        id,
        result: null,
        error: {
          code: err.code,
          message: err.rpcMessage,
          ...(err.data ? { data: err.data } : {}),
        },
      };
    }
  }

  private dispatch(method: string, p: Params, credentials: Record<string, string>) {
    switch (method) {
      case 'CheckPerformTransaction':
        return this.checkPerformTransaction(p, credentials);
      case 'CreateTransaction':
        return this.createTransaction(p);
      case 'PerformTransaction':
        return this.performTransaction(p);
      case 'CancelTransaction':
        return this.cancelTransaction(p);
      case 'CheckTransaction':
        return this.checkTransaction(p);
      case 'GetStatement':
        return this.getStatement(p);
      case 'ChangePassword':
        return this.changePassword(p, credentials);
      default:
        throw new PaymeRpcError(PaymeError.METHOD_NOT_FOUND, M.methodNotFound, method);
    }
  }

  // ── Methods ──

  private async checkPerformTransaction(p: Params, credentials: Record<string, string>) {
    const amount = parseAmount(p);
    const order = await this.findOrder(this.prisma, p);
    this.validateOrder(order, amount);
    // Template: another created/performed transaction for this order blocks a new payment.
    if (order.payments.some((x) => isPaymeActive(x)))
      throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.otherTxn);
    const detail = credentials.fiscalDetail === 'off' ? null : this.receiptDetail(order);
    return detail ? { allow: true, detail } : { allow: true };
  }

  private async createTransaction(p: Params) {
    const amount = parseAmount(p);
    const txnId = requireString(p, 'id');
    const time = toMs(requireNumber(p, 'time'));
    const now = this.now();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const located = await this.findOrder(tx, p);
      await this.lifecycle.lockOrder(tx, located.id);
      const order = await this.reloadOrder(tx, located.id);
      // Re-checked under the lock: "pay again" may have switched the order to Click meanwhile.
      if (order.paymentMethod !== 'PAYME')
        throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.orderCode, PAYME_ACCOUNT_FIELD);
      this.validateOrder(order, amount);
      if (order.payments.some((x) => isPaymeActive(x) && x.providerTxnId !== txnId))
        throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.otherTxn);

      const found = await findTxn(tx, txnId);
      if (found) {
        if (found.providerState !== PaymeState.CREATED)
          throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.txnNotActive);
        if (isPaymeTxnExpired(PaymeState.CREATED, txnData(found).createTime, now)) {
          await this.cancelCreated(tx, found, PaymeReason.CANCELLED_BY_TIMEOUT, now);
          return { expired: true as const };
        }
        return {
          result: {
            create_time: txnData(found).createTime,
            transaction: found.id,
            state: PaymeState.CREATED,
            receivers: null,
          },
        };
      }
      if (isPaymeCreateTimeTooOld(time, now))
        throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.createTimeout, 'time');
      const data: PaymeTxnData = { time, createTime: now };
      const paymentId = await this.lifecycle.attachProviderTxnInTx(
        tx,
        order.id,
        'PAYME',
        txnId,
        { providerState: PaymeState.CREATED, providerData: { ...data } },
        PROVIDER,
      );
      return {
        result: {
          create_time: now,
          transaction: paymentId,
          state: PaymeState.CREATED,
          receivers: null,
        },
      };
    });
    // The timeout cancel must be committed before answering with the error.
    if ('expired' in outcome) throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.txnExpired);
    return outcome.result;
  }

  private async performTransaction(p: Params) {
    const txnId = requireString(p, 'id');
    const now = this.now();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockTxn(tx, txnId);
      if (payment.providerState === PaymeState.PERFORMED) {
        return { result: performResult(payment) };
      }
      if (payment.providerState !== PaymeState.CREATED)
        throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.couldNotPerform);
      if (isPaymeTxnExpired(PaymeState.CREATED, txnData(payment).createTime, now)) {
        await this.cancelCreated(tx, payment, PaymeReason.CANCELLED_BY_TIMEOUT, now);
        return { expired: true as const };
      }
      const order = await this.reloadOrder(tx, payment.orderId);
      const paidElsewhere = order.payments.some((x) => x.status === 'PAID' && x.id !== payment.id);
      // The reservation job may have expired the order meanwhile, or Click paid it: never take
      // money for an order we can't fulfil — Payme will cancel the transaction after this error.
      if (order.status !== 'NEW' || payment.status !== 'PENDING' || paidElsewhere)
        throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.couldNotPerform);
      const orderId = await this.lifecycle.markPaidInTx(tx, payment.id, PROVIDER, {
        now: new Date(now),
        providerState: PaymeState.PERFORMED,
      });
      const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return { result: performResult(updated), orderId };
    });
    if ('expired' in outcome) throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.txnExpired);
    // Respond fast: the SMS goes out after the answer (notifications never throw).
    if (outcome.orderId) void this.lifecycle.notifyPaid(outcome.orderId);
    return outcome.result;
  }

  private async cancelTransaction(p: Params) {
    const txnId = requireString(p, 'id');
    const reason = requireNumber(p, 'reason');
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockTxn(tx, txnId);
      switch (payment.providerState) {
        case PaymeState.CANCELLED:
        case PaymeState.CANCELLED_AFTER_PERFORM:
          return cancelResult(payment);
        case PaymeState.CREATED: {
          const cancelled = await this.cancelCreated(tx, payment, reason, now);
          return cancelResult(cancelled);
        }
        case PaymeState.PERFORMED: {
          const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
          if (!orderAllowsRefund(order.status))
            throw new PaymeRpcError(PaymeError.COULD_NOT_CANCEL, M.couldNotCancel);
          const refunded = await tx.refund.aggregate({
            where: { paymentId: payment.id },
            _sum: { amountTiyin: true },
          });
          try {
            await this.lifecycle.refundInTx(tx, payment.id, PROVIDER, {
              amountTiyin: payment.amountTiyin - (refunded._sum.amountTiyin ?? 0n),
              reason: `payme_cancel_reason_${reason}`,
              refundedBy: 'provider:payme',
              extra: {
                providerState: PaymeState.CANCELLED_AFTER_PERFORM,
                cancelledAt: new Date(now),
                cancelReason: reason,
              },
            });
          } catch (e) {
            if (e instanceof DomainError)
              throw new PaymeRpcError(PaymeError.COULD_NOT_CANCEL, M.couldNotCancel);
            throw e;
          }
          return cancelResult(await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }));
        }
        default:
          throw new PaymeRpcError(PaymeError.COULD_NOT_CANCEL, M.couldNotCancel);
      }
    });
  }

  private async checkTransaction(p: Params) {
    const txnId = requireString(p, 'id');
    const payment = await findTxn(this.prisma, txnId);
    if (!payment) throw new PaymeRpcError(PaymeError.TRANSACTION_NOT_FOUND, M.txnNotFound);
    return {
      create_time: txnData(payment).createTime,
      perform_time: ms(payment.performedAt),
      cancel_time: ms(payment.cancelledAt),
      transaction: payment.id,
      state: payment.providerState,
      reason: payment.cancelReason ?? null,
    };
  }

  private async getStatement(p: Params) {
    const from = p.from;
    const to = p.to;
    if (typeof from !== 'number')
      throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.period, 'from');
    if (typeof to !== 'number') throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.period, 'to');
    if (from >= to) throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.period, 'from');
    // Period boundaries included, by Payme's transaction time (template `Transaction::report`).
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Payment"
      WHERE "method"::text = 'PAYME' AND "providerTxnId" IS NOT NULL
        AND ("providerData"->>'time')::bigint BETWEEN ${BigInt(Math.trunc(from))} AND ${BigInt(Math.trunc(to))}
      ORDER BY ("providerData"->>'time')::bigint, "id"`;
    const rows = await this.prisma.payment.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: { order: { select: { number: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      transactions: ids
        .map((r) => byId.get(r.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r.providerTxnId,
          time: txnData(r).time,
          amount: Number(r.amountTiyin),
          account: { [PAYME_ACCOUNT_FIELD]: r.order.number },
          create_time: txnData(r).createTime,
          perform_time: ms(r.performedAt),
          cancel_time: ms(r.cancelledAt),
          transaction: r.id,
          state: r.providerState,
          reason: r.cancelReason ?? null,
          receivers: null,
        })),
    };
  }

  private async changePassword(p: Params, credentials: Record<string, string>) {
    const password = typeof p.password === 'string' ? p.password.trim() : '';
    if (!password)
      throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.passwordMissing, 'password');
    if (password === paymeAuthKey(credentials))
      throw new PaymeRpcError(PaymeError.INSUFFICIENT_PRIVILEGE, M.passwordSame);
    await this.integrations.rotateSecret('payme', paymeKeyField(credentials), password, 'payme');
    return { success: true };
  }

  // ── Helpers ──

  private async findOrder(db: Tx | PrismaService, p: Params): Promise<OrderRow> {
    const account = p.account && typeof p.account === 'object' ? (p.account as Params) : {};
    const value = account[PAYME_ACCOUNT_FIELD];
    const number = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    const order = number
      ? await db.order.findUnique({ where: { number }, include: orderInclude })
      : null;
    // COD orders and orders placed for Click are not payable here: same answer as "unknown".
    if (!order || order.paymentMethod !== 'PAYME')
      throw new PaymeRpcError(PaymeError.INVALID_ACCOUNT, M.orderCode, PAYME_ACCOUNT_FIELD);
    return order;
  }

  private reloadOrder(tx: Tx, orderId: string): Promise<OrderRow> {
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  }

  /** Template `Order::validate` after lookup: exact amount, then "waiting for payment" state. */
  private validateOrder(order: OrderRow, amount: bigint): void {
    if (amount !== order.totalTiyin) throw new PaymeRpcError(PaymeError.INVALID_AMOUNT, M.amount);
    if (order.payments.some((x) => x.status === 'PAID' || x.status === 'PARTIALLY_REFUNDED'))
      throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.alreadyPaid);
    const now = this.now();
    const reservationAlive = order.reservations.some(
      (r) => r.expiresAt && r.expiresAt.getTime() > now,
    );
    if (order.status !== 'NEW' || !reservationAlive)
      throw new PaymeRpcError(PaymeError.COULD_NOT_PERFORM, M.notPayable);
  }

  private async lockTxn(tx: Tx, txnId: string): Promise<PaymentRow> {
    const found = await findTxn(tx, txnId);
    if (!found) throw new PaymeRpcError(PaymeError.TRANSACTION_NOT_FOUND, M.txnNotFound);
    // Lock order first, then payment — the same order every writer uses (no deadlocks).
    await this.lifecycle.lockOrder(tx, found.orderId);
    await this.lifecycle.lockPayment(tx, found.id);
    return tx.payment.findUniqueOrThrow({ where: { id: found.id } });
  }

  private async cancelCreated(
    tx: Tx,
    payment: PaymentRow,
    reason: number,
    now: number,
  ): Promise<PaymentRow> {
    await this.lifecycle.failAttemptInTx(tx, payment.id, PROVIDER, {
      providerState: PaymeState.CANCELLED,
      cancelledAt: new Date(now),
      cancelReason: reason,
    });
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private receiptDetail(order: OrderRow): PaymeReceiptDetail | null {
    const detail = buildPaymeReceiptDetail(
      order.items.map((i) => {
        const snap = i.nameSnapshot as { product?: unknown; variant?: unknown };
        return {
          // Fiscal titles in Uzbek (state language), with the variant (volume/colour).
          title: [t(snap.product, 'uz'), t(snap.variant, 'uz')].filter(Boolean).join(', '),
          ikpu: i.ikpu,
          packageCode: i.packageCode,
          vatPercent: i.vatPercent,
          qty: i.qty,
          unitPriceTiyin: i.priceTiyin,
          discountTiyin: i.discountTiyin,
        };
      }),
      { title: 'Yetkazib berish', priceTiyin: order.shippingTiyin },
      order.totalTiyin,
    );
    if (!detail) this.logger.warn(`receipt lines don't add up for ${order.number}; detail omitted`);
    return detail;
  }

  /** IntegrationLog row per call; fire-and-forget so logging never delays Payme's answer. */
  private audit(method: string, ok: boolean, message: string, params: unknown): void {
    void this.integrations
      .log('payme', {
        direction: 'IN',
        kind: `webhook.${method}`,
        ok,
        message,
        payload: { method, params },
      })
      .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
  }
}

// ── Pure helpers ──

function findTxn(db: Tx | PrismaService, txnId: string): Promise<PaymentRow | null> {
  return db.payment.findUnique({
    where: { method_providerTxnId: { method: 'PAYME', providerTxnId: txnId } },
  });
}

function isPaymeActive(p: PaymentRow): boolean {
  return (
    p.method === 'PAYME' &&
    p.providerTxnId !== null &&
    (p.providerState === PaymeState.CREATED || p.providerState === PaymeState.PERFORMED)
  );
}

function txnData(p: PaymentRow): PaymeTxnData {
  const d = (p.providerData ?? {}) as Partial<PaymeTxnData>;
  return { time: Number(d.time ?? 0), createTime: Number(d.createTime ?? p.createdAt.getTime()) };
}

/** Payme expects 0 for "not happened yet" timestamps. */
function ms(d: Date | null): number {
  return d ? d.getTime() : 0;
}

function performResult(p: PaymentRow) {
  return { transaction: p.id, perform_time: ms(p.performedAt), state: p.providerState };
}

function cancelResult(p: PaymentRow) {
  return { transaction: p.id, cancel_time: ms(p.cancelledAt), state: p.providerState };
}

/** Template `Format::timestamp2milliseconds`: 10-digit values are seconds. */
function toMs(value: number): number {
  return String(Math.trunc(value)).length === 10 ? value * 1000 : value;
}

/** Amount in tiyin: must be a non-negative integer (template: numeric, then exact match). */
function parseAmount(p: Params): bigint {
  const a = p.amount;
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a < 0)
    throw new PaymeRpcError(PaymeError.INVALID_AMOUNT, M.amount);
  return BigInt(a);
}

function requireString(p: Params, field: string): string {
  const v = p[field];
  if (typeof v !== 'string' || !v)
    throw new PaymeRpcError(PaymeError.INVALID_JSON_RPC_OBJECT, M.invalidRpc, field);
  return v;
}

function requireNumber(p: Params, field: string): number {
  const v = p[field];
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new PaymeRpcError(PaymeError.INVALID_JSON_RPC_OBJECT, M.invalidRpc, field);
  return v;
}

/** Optional allowlist from the integration settings (Payme's IPs are not published in the repo). */
export function ipAllowed(allowlist: string | undefined, ip: string | null): boolean {
  const list = (allowlist ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return true;
  const normalized = ip?.replace(/^::ffff:/, '') ?? '';
  return list.includes(normalized);
}
