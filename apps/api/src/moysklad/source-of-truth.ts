import { parseMoyskladSettings } from '@forest/contracts';
import type { Prisma } from '@forest/db';

type Db = Pick<Prisma.TransactionClient, 'integration'>;

export interface CatalogLocks {
  /** 'moysklad': MoySklad creates/links variants and owns product existence (docs/02). */
  source: 'moysklad' | 'local';
  /** Price (and compare-at) is written by the MoySklad sync — read-only in admin. */
  price: boolean;
  /** Stock is written by the MoySklad sync — read-only in admin. */
  stock: boolean;
}

/**
 * docs/02 "MoySklad is master for price and stock" as the sync applies it (CLAUDE.md §6): the
 * catalog belongs to MoySklad while the integration is CONNECTED and its products flow is on;
 * price/stock are locked only while their own flows are on, so an Owner who switches a flow off
 * gets the field back in admin. Reads only `db.integration` (works inside a transaction).
 */
export async function catalogLocks(db: Db): Promise<CatalogLocks> {
  const row = await db.integration.findUnique({
    where: { key: 'moysklad' },
    select: { status: true, config: true },
  });
  if (row?.status !== 'CONNECTED') return { source: 'local', price: false, stock: false };
  const { flows } = parseMoyskladSettings(row.config);
  return { source: flows.products ? 'moysklad' : 'local', price: flows.prices, stock: flows.stock };
}

export async function catalogSourceOfTruth(db: Db): Promise<'moysklad' | 'local'> {
  return (await catalogLocks(db)).source;
}
