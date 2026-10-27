import type { Prisma } from '@forest/db';
import { catalogLocks } from './source-of-truth';

type Tx = Prisma.TransactionClient;

/**
 * Where an order's stock hold ends (CLAUDE.md §6). Called inside the order-status transaction
 * (caller holds the order row lock); both functions are idempotent.
 */

/**
 * Goods left the warehouse (HANDED_TO_COURIER): close the still-open reservations. With the
 * MoySklad stock flow on, MoySklad's own stock drops when staff ship there (and the next snapshot
 * shows it), so the hold is just released; otherwise the shipped qty is consumed from our stock.
 */
export async function endHoldsOnShipment(tx: Tx, orderId: string, now = new Date()): Promise<void> {
  const open = await tx.reservation.findMany({ where: { orderId, releasedAt: null } });
  if (!open.length) return;
  const { stock: moyskladStock } = await catalogLocks(tx);
  for (const r of [...open].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    if (moyskladStock)
      await tx.$executeRaw`
        UPDATE "Variant" SET "reserved" = GREATEST("reserved" - ${r.qty}, 0) WHERE "id" = ${r.variantId}`;
    else
      await tx.$executeRaw`
        UPDATE "Variant"
        SET "reserved" = GREATEST("reserved" - ${r.qty}, 0), "stock" = GREATEST("stock" - ${r.qty}, 0)
        WHERE "id" = ${r.variantId}`;
  }
  await tx.reservation.updateMany({
    where: { id: { in: open.map((r) => r.id) }, releasedAt: null },
    data: { releasedAt: now },
  });
}

/**
 * A CANCELLED order whose hold was handed over to MoySklad (our stock was lowered then): with the
 * stock flow off by now, no snapshot will bring the qty back, so it is restored here — once.
 * With the flow on, clearing the MoySklad reserve (order sync) makes the next snapshot do it.
 */
export async function restoreHandedOverHold(tx: Tx, orderId: string): Promise<void> {
  const link = await tx.moyskladOrderLink.findUnique({
    where: { orderId },
    select: { holdHandedOver: true },
  });
  if (!link?.holdHandedOver) return;
  if ((await catalogLocks(tx)).stock) return;
  const rows = await tx.reservation.findMany({
    where: { orderId, releasedAt: { not: null } },
    select: { variantId: true, qty: true },
  });
  const byVariant = new Map<string, number>();
  for (const r of rows) byVariant.set(r.variantId, (byVariant.get(r.variantId) ?? 0) + r.qty);
  for (const [variantId, qty] of [...byVariant].sort(([a], [b]) => a.localeCompare(b)))
    await tx.$executeRaw`UPDATE "Variant" SET "stock" = "stock" + ${qty} WHERE "id" = ${variantId}`;
  await tx.moyskladOrderLink.update({ where: { orderId }, data: { holdHandedOver: false } });
}
