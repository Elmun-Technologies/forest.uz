import {
  ADMIN_TAB_STATUSES,
  type AdminOrderFilter,
  type AdminOrderSort,
  type AdminOrderTab,
  DomainError,
  SLA_RISK_WINDOW_MS,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';

/**
 * A6 list filters → Prisma `where` (CLAUDE.md §6 tab mapping). Pure, so the mapping is unit-tested
 * and the list, tab counts and CSV export share one definition.
 */

const SETTLED = ['PAID', 'PARTIALLY_REFUNDED'] as const;

const dayStart = (iso: string) => new Date(`${iso}T00:00:00+05:00`);

/** Search: order number, customer name, phone digits, carrier track number. */
function searchWhere(raw: string): Prisma.OrderWhereInput | null {
  const q = raw.trim();
  if (!q) return null;
  const number = /^f-?(\d{3,})$/i.exec(q);
  if (number) return { number: `F-${number[1]}` };
  const digits = q.replace(/[\s()+-]/g, '');
  if (/^\d{3,}$/.test(digits))
    return {
      OR: [
        { contactPhone: { contains: digits } },
        { number: { contains: digits } },
        { shipments: { some: { trackNumber: { contains: digits, mode: 'insensitive' } } } },
      ],
    };
  return {
    OR: [
      { contactName: { contains: q, mode: 'insensitive' } },
      { shipments: { some: { trackNumber: { contains: q, mode: 'insensitive' } } } },
    ],
  };
}

/** Every filter except the tab (tab counts are computed over this). */
export function baseWhere(f: AdminOrderFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  const search = f.q ? searchWhere(f.q) : null;
  if (search) and.push(search);
  if (f.paymentMethod) and.push({ paymentMethod: f.paymentMethod });
  if (f.carrier) and.push({ carrier: f.carrier });
  if (f.source) and.push({ source: f.source });
  if (f.payment === 'paid') and.push({ payments: { some: { status: { in: [...SETTLED] } } } });
  if (f.payment === 'unpaid')
    and.push({ payments: { none: { status: { in: [...SETTLED, 'REFUNDED'] } } } });
  if (f.payment === 'refunded')
    and.push({ payments: { some: { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } } } });
  if (f.from) and.push({ createdAt: { gte: dayStart(f.from) } });
  if (f.to) and.push({ createdAt: { lt: new Date(dayStart(f.to).getTime() + 86_400_000) } });
  return and.length ? { AND: and } : {};
}

export function tabWhere(tab: AdminOrderTab, now: Date): Prisma.OrderWhereInput {
  switch (tab) {
    case 'all':
      return {};
    case 'confirm':
      return { status: 'NEW', paymentMethod: 'COD' };
    case 'awaiting_payment':
      return { status: 'NEW', paymentMethod: { not: 'COD' } };
    case 'sla_risk':
      return {
        status: { in: [...ADMIN_TAB_STATUSES.sla_risk] },
        slaDueAt: { lt: new Date(now.getTime() + SLA_RISK_WINDOW_MS) },
      };
    default:
      return { status: { in: [...ADMIN_TAB_STATUSES[tab]] } };
  }
}

export function listWhere(f: AdminOrderFilter, now: Date): Prisma.OrderWhereInput {
  return { AND: [baseWhere(f), tabWhere(f.tab, now)] };
}

// ───────── keyset cursor over the chosen sort ─────────

type SortSpec = { field: 'createdAt' | 'slaDueAt' | 'totalTiyin'; dir: 'asc' | 'desc' };

const SORTS: Record<AdminOrderSort, SortSpec> = {
  created_desc: { field: 'createdAt', dir: 'desc' },
  created_asc: { field: 'createdAt', dir: 'asc' },
  sla_asc: { field: 'slaDueAt', dir: 'asc' },
  total_desc: { field: 'totalTiyin', dir: 'desc' },
};

export interface OrderCursor {
  /** Sort value: ISO date, bigint string, or null (orders without an SLA, sorted last). */
  v: string | null;
  id: string;
}

export function orderBy(sort: AdminOrderSort): Prisma.OrderOrderByWithRelationInput[] {
  const { field, dir } = SORTS[sort];
  if (field === 'slaDueAt') return [{ slaDueAt: { sort: dir, nulls: 'last' } }, { id: dir }];
  return [{ [field]: dir }, { id: dir }];
}

export function cursorValue(
  sort: AdminOrderSort,
  row: { createdAt: Date; slaDueAt: Date | null; totalTiyin: bigint },
): string | null {
  const { field } = SORTS[sort];
  if (field === 'totalTiyin') return row.totalTiyin.toString();
  return row[field]?.toISOString() ?? null;
}

export function encodeCursor(c: OrderCursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id])).toString('base64url');
}

export function decodeCursor(raw: string): OrderCursor {
  try {
    const [v, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (typeof id === 'string' && id && (v === null || typeof v === 'string')) return { v, id };
  } catch {
    // fall through
  }
  throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
}

/** Rows strictly after the cursor in `orderBy(sort)` order. */
export function afterCursor(sort: AdminOrderSort, c: OrderCursor): Prisma.OrderWhereInput {
  const { field, dir } = SORTS[sort];
  const op = dir === 'asc' ? 'gt' : 'lt';
  if (field === 'slaDueAt') {
    if (c.v === null) return { slaDueAt: null, id: { gt: c.id } };
    const v = new Date(c.v);
    return {
      OR: [{ slaDueAt: { gt: v } }, { slaDueAt: v, id: { gt: c.id } }, { slaDueAt: null }],
    };
  }
  if (c.v === null || (field === 'totalTiyin' && !/^\d{1,30}$/.test(c.v)))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  const v = field === 'totalTiyin' ? BigInt(c.v) : new Date(c.v);
  if (v instanceof Date && Number.isNaN(v.getTime()))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { OR: [{ [field]: { [op]: v } }, { [field]: v, id: { [op]: c.id } }] };
}
