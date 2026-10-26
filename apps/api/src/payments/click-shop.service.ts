import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@forest/db';
import { maskPhonesInText } from '../common/redact';
import { OrderLifecycleService } from '../commerce/order-lifecycle.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  ClickAction,
  clickAmountToTiyin,
  ClickError,
  type ClickErrorEntry,
  clickMerchantId,
  type ClickRequest,
  ClickTxnState,
  isClickSignValid,
  parseClickRequest,
} from '../integrations/providers/click';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface ClickResponse {
  click_trans_id: number | string | null;
  merchant_trans_id: string | null;
  merchant_prepare_id: number;
  merchant_confirm_id: number;
  error: number;
  error_note: string;
}

const PROVIDER = { type: 'PAYMENT_PROVIDER' as const, id: 'click' };

const orderInclude = {
  payments: { orderBy: { createdAt: 'desc' } },
  reservations: { where: { releasedAt: null } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type PaymentRow = Prisma.PaymentGetPayload<object>;

class ClickFailure extends Error {
  constructor(readonly entry: ClickErrorEntry) {
    super(entry.error_note);
  }
}

/**
 * Click SHOP API Prepare/Complete — checks in the order of the official PHP library
 * (`BasicPaymentsErrors::request_check`): -8 request, -1 sign, -3 action, -5 order, -6 prepared
 * transaction (complete), -4 already paid, -2 amount, -9 cancelled. State changes go through
 * OrderLifecycleService under order → payment row locks: repeated/concurrent Complete calls pay
 * once and repeats are answered -4 like the library does.
 */
@Injectable()
export class ClickShopService {
  private readonly logger = new Logger('ClickShop');
  /** Overridable in tests (fixed clock). */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly integrations: IntegrationsService,
  ) {}

  prepare(body: unknown): Promise<ClickResponse> {
    return this.handle(body, ClickAction.PREPARE);
  }

  complete(body: unknown): Promise<ClickResponse> {
    return this.handle(body, ClickAction.COMPLETE);
  }

  private async handle(body: unknown, action: 0 | 1): Promise<ClickResponse> {
    const req = parseClickRequest(body);
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const base = {
      click_trans_id: asId(req?.click_trans_id ?? raw.click_trans_id),
      merchant_trans_id: req?.merchant_trans_id ?? null,
      merchant_prepare_id: 0,
      merchant_confirm_id: 0,
    };
    if (!req) return this.answer(base, ClickError.BAD_REQUEST, action, null);
    const credentials = await this.integrations.connectedCredentials('click');
    // Not connected = no secret to verify with: answer like a bad signature.
    if (!credentials?.secretKey || !isClickSignValid(req, credentials.secretKey))
      return this.answer(base, ClickError.SIGN_CHECK_FAILED, action, null);
    if (req.action !== String(action))
      return this.answer(base, ClickError.ACTION_NOT_FOUND, action, req);

    const located = await this.prisma.order.findUnique({
      where: { number: req.merchant_trans_id },
      select: { id: true, number: true, paymentMethod: true },
    });
    // COD orders and orders placed for Payme are not payable here: same answer as "unknown".
    if (!located || located.paymentMethod !== 'CLICK')
      return this.answer(base, ClickError.USER_NOT_FOUND, action, req);
    const ids = { merchant_prepare_id: clickMerchantId(located.number) };
    const withIds = { ...base, ...ids, merchant_confirm_id: ids.merchant_prepare_id };

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lifecycle.lockOrder(tx, located.id);
        const order = await tx.order.findUniqueOrThrow({
          where: { id: located.id },
          include: orderInclude,
        });
        return action === ClickAction.PREPARE
          ? this.doPrepare(tx, order, req)
          : this.doComplete(tx, order, req, ids.merchant_prepare_id);
      });
      if (outcome.paidOrderId) void this.lifecycle.notifyPaid(outcome.paidOrderId);
      return this.answer(withIds, outcome.entry, action, req);
    } catch (e) {
      if (e instanceof ClickFailure) return this.answer(withIds, e.entry, action, req);
      this.logger.error(maskPhonesInText(e instanceof Error ? (e.stack ?? e.message) : String(e)));
      return this.answer(withIds, ClickError.UPDATE_FAILED, action, req);
    }
  }

  private async doPrepare(
    tx: Tx,
    order: OrderRow,
    req: ClickRequest,
  ): Promise<{ entry: ClickErrorEntry; paidOrderId?: string }> {
    // Re-checked under the order lock: "pay again" may have switched the order to Payme meanwhile.
    if (order.paymentMethod !== 'CLICK') throw new ClickFailure(ClickError.USER_NOT_FOUND);
    this.checkPayable(order, req, null);
    const existing = await findTxn(tx, req.click_trans_id);
    // A repeated Prepare for the same Click transaction is answered again without a new row.
    if (!existing) {
      await this.lifecycle.attachProviderTxnInTx(
        tx,
        order.id,
        'CLICK',
        req.click_trans_id,
        { providerState: ClickTxnState.PREPARED, providerData: providerData(req) },
        PROVIDER,
      );
    } else if (existing.orderId !== order.id || existing.providerState !== ClickTxnState.PREPARED) {
      throw new ClickFailure(ClickError.TRANSACTION_CANCELLED);
    }
    return { entry: ClickError.SUCCESS };
  }

  private async doComplete(
    tx: Tx,
    order: OrderRow,
    req: ClickRequest,
    prepareId: number,
  ): Promise<{ entry: ClickErrorEntry; paidOrderId?: string }> {
    const found = await findTxn(tx, req.click_trans_id);
    if (!found || found.orderId !== order.id || req.merchant_prepare_id !== String(prepareId))
      throw new ClickFailure(ClickError.TRANSACTION_NOT_FOUND);
    await this.lifecycle.lockPayment(tx, found.id);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });

    let check: ClickErrorEntry = ClickError.SUCCESS;
    try {
      this.checkPayable(order, req, payment);
    } catch (e) {
      if (!(e instanceof ClickFailure)) throw e;
      check = e.entry;
    }
    // Click reports the payment failed on its side: reject our attempt (library behaviour), but
    // only for an authenticated request about a live transaction (never after -4/-9).
    if (
      Number(req.error) < 0 &&
      check !== ClickError.ALREADY_PAID &&
      check !== ClickError.TRANSACTION_CANCELLED
    ) {
      await this.lifecycle.failAttemptInTx(tx, payment.id, PROVIDER, {
        providerState: ClickTxnState.CANCELLED,
        cancelledAt: new Date(this.now()),
        providerData: { ...providerData(req), clickError: req.error },
      });
      return { entry: ClickError.TRANSACTION_CANCELLED };
    }
    if (check !== ClickError.SUCCESS) return { entry: check };
    const paidOrderId = await this.lifecycle.markPaidInTx(tx, payment.id, PROVIDER, {
      now: new Date(this.now()),
      providerState: ClickTxnState.COMPLETED,
      providerData: providerData(req),
    });
    return { entry: ClickError.SUCCESS, paidOrderId: paidOrderId ?? undefined };
  }

  /** -4 already paid → -2 amount → -9 cancelled, as in the library. */
  private checkPayable(order: OrderRow, req: ClickRequest, payment: PaymentRow | null): void {
    if (order.payments.some((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED'))
      throw new ClickFailure(ClickError.ALREADY_PAID);
    if (clickAmountToTiyin(req.amount) !== order.totalTiyin)
      throw new ClickFailure(ClickError.INCORRECT_AMOUNT);
    const now = this.now();
    const reservationAlive = order.reservations.some(
      (r) => r.expiresAt && r.expiresAt.getTime() > now,
    );
    const attemptDead =
      payment !== null &&
      (payment.providerState === ClickTxnState.CANCELLED || payment.status !== 'PENDING');
    if (order.status !== 'NEW' || !reservationAlive || attemptDead)
      throw new ClickFailure(ClickError.TRANSACTION_CANCELLED);
  }

  private answer(
    base: Omit<ClickResponse, 'error' | 'error_note'>,
    entry: ClickErrorEntry,
    action: 0 | 1,
    logged: unknown,
  ): ClickResponse {
    // Unsigned requests are not logged as provider traffic (anyone can hit the URL).
    if (logged !== null) {
      void this.integrations
        .log('click', {
          direction: 'IN',
          kind: action === ClickAction.PREPARE ? 'webhook.prepare' : 'webhook.complete',
          ok: entry.error === 0,
          message: `${entry.error} ${entry.error_note}`,
          payload: logged,
        })
        .catch((e: unknown) => this.logger.warn(`integration log failed: ${String(e)}`));
    }
    return { ...base, error: entry.error, error_note: entry.error_note };
  }
}

function findTxn(tx: Tx, clickTransId: string): Promise<PaymentRow | null> {
  return tx.payment.findUnique({
    where: { method_providerTxnId: { method: 'CLICK', providerTxnId: clickTransId } },
  });
}

function providerData(req: ClickRequest): Record<string, string> {
  return { clickPaydocId: req.click_paydoc_id, signTime: req.sign_time };
}

/** Click ids are integers; echo them as numbers when they are. */
function asId(v: unknown): number | string | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v) return null;
  const n = Number(v);
  return /^\d+$/.test(v) && Number.isSafeInteger(n) ? n : v;
}
