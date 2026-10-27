import { Injectable } from '@nestjs/common';
import { DomainError } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { PrismaService } from '../prisma/prisma.service';
import type { TxHook } from './order-lifecycle.service';

type Tx = Prisma.TransactionClient;

export type FiscalEvidence = 'receipt' | 'payment_url' | 'payme_detail';

/**
 * What proves the sale was fiscalized (CLAUDE.md §6, docs/06 Fiscal): a recorded receipt
 * (operator / OFD), a receipt URL on the paid payment, or a Payme payment whose transaction was
 * created with receipt `detail` (Payme issues the receipt). Null = the order can't be closed.
 */
export async function fiscalEvidence(tx: Tx, orderId: string): Promise<FiscalEvidence | null> {
  const receipt = await tx.fiscalReceipt.findUnique({
    where: { orderId_kind: { orderId, kind: 'SALE' } },
    select: { id: true },
  });
  if (receipt) return 'receipt';
  const paid = await tx.payment.findFirst({
    where: { orderId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
    select: { method: true, fiscalReceiptUrl: true, providerData: true },
  });
  if (paid?.fiscalReceiptUrl) return 'payment_url';
  const data = paid?.providerData as { fiscalDetail?: unknown } | null | undefined;
  if (paid?.method === 'PAYME' && data?.fiscalDetail === true) return 'payme_detail';
  return null;
}

type ReceiptFields = { receiptNumber: string | null; url: string | null };

export interface ReceiptChange {
  corrected: boolean;
  before: ReceiptFields | null;
  after: ReceiptFields;
}

export interface ManualReceiptInput {
  receiptUrl?: string | null;
  receiptNumber?: string | null;
}

/** Receipt links are pasted from the OFD / cash-register cabinet: https only, no scripts. */
function cleanUrl(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new DomainError('VALIDATION_FAILED', undefined, 'receiptUrl');
  }
  if (u.protocol !== 'https:' || s.length > 500)
    throw new DomainError('VALIDATION_FAILED', undefined, 'receiptUrl');
  return u.toString();
}

function cleanNumber(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (!/^[\w\-/.: ]{1,64}$/.test(s))
    throw new DomainError('VALIDATION_FAILED', undefined, 'receiptNumber');
  return s;
}

/**
 * Manual fiscal provider (docs/06): the operator issues the receipt on the cash register (COD,
 * or Click until it is known to fiscalize — docs/13 q.34) and records it here from the admin order
 * page (`orders.edit`).
 */
@Injectable()
export class FiscalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records (or corrects) the sale receipt of an order. Audited; OrderEvent FISCAL_RECEIPT. With
   * `audit`, the caller writes the audit row (admin `AuditService`, same transaction) instead.
   */
  async recordManualReceipt(
    orderId: string,
    input: ManualReceiptInput,
    staffId: string,
    ip: string | null = null,
    audit?: (tx: Parameters<TxHook>[0], change: ReceiptChange) => Promise<void>,
  ): Promise<{ id: string; corrected: boolean }> {
    const url = cleanUrl(input.receiptUrl);
    const receiptNumber = cleanNumber(input.receiptNumber);
    if (!url && !receiptNumber)
      throw new DomainError(
        'VALIDATION_FAILED',
        { required: 'receiptUrl|receiptNumber' },
        'receiptNumber',
      );

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, payments: { select: { id: true, status: true } } },
      });
      if (!order) throw new DomainError('ORDER_NOT_FOUND');
      // No sale happened on a cancelled order (nothing to fiscalize).
      if (order.status === 'CANCELLED')
        throw new DomainError('ORDER_INVALID_TRANSITION', { from: order.status, to: 'FISCALIZED' });
      const before = await tx.fiscalReceipt.findUnique({
        where: { orderId_kind: { orderId, kind: 'SALE' } },
      });
      const paymentId =
        order.payments.find((p) => p.status === 'PAID' || p.status === 'COD_PENDING')?.id ?? null;
      const data = { provider: 'manual', url, receiptNumber, staffId, paymentId };
      const row = await tx.fiscalReceipt.upsert({
        where: { orderId_kind: { orderId, kind: 'SALE' } },
        update: data,
        create: { orderId, kind: 'SALE', ...data },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'FISCAL_RECEIPT',
          actorType: 'STAFF',
          actorId: staffId,
          data: {
            provider: 'manual',
            receiptNumber,
            hasUrl: Boolean(url),
            corrected: Boolean(before),
          },
        },
      });
      if (audit)
        await audit(tx, {
          corrected: Boolean(before),
          before: before ? { receiptNumber: before.receiptNumber, url: before.url } : null,
          after: { receiptNumber, url },
        });
      else
        await tx.auditLog.create({
          data: {
            staffId,
            action: before ? 'order.fiscal_receipt_corrected' : 'order.fiscal_receipt_recorded',
            entity: 'Order',
            entityId: orderId,
            before: before ? { receiptNumber: before.receiptNumber, url: before.url } : undefined,
            after: { receiptNumber, url },
            ip,
          },
        });
      return { id: row.id, corrected: Boolean(before) };
    });
  }
}
