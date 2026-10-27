import { Injectable } from '@nestjs/common';
import type { CatalogSource } from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { catalogLocks } from '../../moysklad/source-of-truth';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface CatalogLocks {
  source: CatalogSource;
  /** Price and compare-at come from MoySklad (read-only here). */
  price: boolean;
  /** Stock comes from MoySklad (read-only here). */
  stock: boolean;
}

/**
 * docs/02 "MoySklad is master for price and stock". Delegates to the MoySklad sync's own switch
 * (`moysklad/source-of-truth.ts`) so the admin editor and the sync always agree, also when the
 * owner toggles a single flow (e.g. stock synced, price edited here). CLAUDE.md §6.
 */
@Injectable()
export class CatalogSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async catalogSourceOfTruth(db: Db = this.prisma): Promise<CatalogSource> {
    return (await this.locks(db)).source;
  }

  async locks(db: Db = this.prisma): Promise<CatalogLocks> {
    const l = await catalogLocks(db);
    return { source: l.source, price: l.price, stock: l.stock };
  }

  /** When the MoySklad integration last checked in (null when not the source). */
  async checkedAt(db: Db = this.prisma): Promise<Date | null> {
    const row = await db.integration.findUnique({
      where: { key: 'moysklad' },
      select: { status: true, lastCheckAt: true },
    });
    return row?.status === 'CONNECTED' ? row.lastCheckAt : null;
  }
}
