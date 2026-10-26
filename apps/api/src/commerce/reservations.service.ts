import { Injectable } from '@nestjs/common';
import { DomainError } from '@forest/contracts';
import type { Prisma } from '@forest/db';

type Tx = Prisma.TransactionClient;

/**
 * Stock reservations (docs/02, invariant 5). Reserving is a single conditional UPDATE per variant,
 * so concurrent checkouts can never oversell: the row is only incremented while
 * `stock - reserved >= qty` holds at write time.
 */
@Injectable()
export class ReservationsService {
  async reserve(
    tx: Tx,
    orderId: string,
    lines: { variantId: string; qty: number }[],
    expiresAt: Date | null,
  ): Promise<void> {
    // Stable lock order avoids deadlocks between two carts holding the same SKUs.
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    for (const l of sorted) {
      const updated = await tx.$executeRaw`
        UPDATE "Variant" SET "reserved" = "reserved" + ${l.qty}
        WHERE "id" = ${l.variantId} AND "active" AND "stock" - "reserved" >= ${l.qty}`;
      if (updated !== 1) throw new DomainError('INSUFFICIENT_STOCK', { variantId: l.variantId });
      await tx.reservation.create({
        data: { orderId, variantId: l.variantId, qty: l.qty, expiresAt },
      });
    }
  }

  /** Releases open reservations of an order (cancel / payment expiry). Idempotent. */
  async release(tx: Tx, orderId: string): Promise<number> {
    const open = await tx.reservation.findMany({ where: { orderId, releasedAt: null } });
    for (const r of open) {
      await tx.$executeRaw`UPDATE "Variant" SET "reserved" = GREATEST("reserved" - ${r.qty}, 0) WHERE "id" = ${r.variantId}`;
    }
    const res = await tx.reservation.updateMany({
      where: { orderId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    return res.count;
  }

  /**
   * Converts reservations into a hard hold once paid/confirmed: the expiry is cleared so the
   * expiry job won't release it. Stock itself is decremented when MoySklad reports shipment.
   */
  async confirm(tx: Tx, orderId: string): Promise<void> {
    await tx.reservation.updateMany({
      where: { orderId, releasedAt: null },
      data: { expiresAt: null },
    });
  }
}
