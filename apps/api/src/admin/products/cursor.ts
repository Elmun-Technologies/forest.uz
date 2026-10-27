import { DomainError } from '@forest/contracts';

/** Opaque `(createdAt, id)` keyset cursor for admin lists (catalog, promo, reviews). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime()))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { createdAt, id };
}

/** Keyset condition for `ORDER BY createdAt <dir>, id <dir>` after `cursor`. */
export function afterCursor(cursor: string | undefined, dir: 'asc' | 'desc') {
  if (!cursor) return {};
  const c = decodeCursor(cursor);
  const op = dir === 'asc' ? 'gt' : 'lt';
  return {
    OR: [{ createdAt: { [op]: c.createdAt } }, { createdAt: c.createdAt, id: { [op]: c.id } }],
  };
}
