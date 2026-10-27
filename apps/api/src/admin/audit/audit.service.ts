import { Injectable } from '@nestjs/common';
import {
  type AuditActorDto,
  type AuditEntryDto,
  type AuditPageDto,
  type AuditQuery,
  DomainError,
} from '@forest/contracts';
import type { Prisma } from '@forest/db';
import { redact } from '../../common/redact';
import { PrismaService } from '../../prisma/prisma.service';

/** Who did it: staff (null = system/provider/unauthenticated), from where. */
export interface AuditActor {
  staffId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Set once this request wrote an audit row (checked by `AuditEnforcementInterceptor`). */
  audited?: boolean;
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Overrides the actor's staff id (e.g. the staff member a login is about). */
  staffId?: string | null;
}

type Db = Pick<Prisma.TransactionClient, 'auditLog'>;

/**
 * Admin audit trail (docs/02: who, what, before/after, IP). Pass the transaction client so the row
 * commits or rolls back with the change. Values go through `redact()`: secrets and PII never land
 * in the log.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actor: AuditActor, entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        staffId: entry.staffId !== undefined ? entry.staffId : actor.staffId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
    });
    actor.audited = true;
  }

  /**
   * PII reveal (docs/02 "full value on detail view for permitted roles, access logged"): loads the
   * data, then logs `<entity>.view_pii` with the field names only. Use for every endpoint that
   * returns unmasked phone/address/email of a customer.
   */
  async reveal<T>(
    actor: AuditActor,
    target: { entity: string; entityId: string; fields: string[]; action?: string },
    load: () => Promise<T>,
  ): Promise<T> {
    const data = await load();
    await this.record(actor, {
      action: target.action ?? `${target.entity.toLowerCase()}.view_pii`,
      entity: target.entity,
      entityId: target.entityId,
      after: { fields: target.fields },
    });
    return data;
  }

  async list(q: AuditQuery): Promise<AuditPageDto> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = new Date(`${q.from}T00:00:00+05:00`);
    if (q.to) createdAt.lt = new Date(new Date(`${q.to}T00:00:00+05:00`).getTime() + 86_400_000);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.staffId ? { staffId: q.staffId } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    // Actors plus staff targets (staff.* rows), so the log reads "invited Madina", not an id.
    const staffIds = [
      ...new Set(page.flatMap((r) => [r.staffId, r.entity === 'Staff' ? r.entityId : null])),
    ].filter((v): v is string => !!v);
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const last = page.at(-1);
    return {
      items: page.map((r): AuditEntryDto => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        staff: r.staffId ? { id: r.staffId, name: nameOf.get(r.staffId) ?? '—' } : null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        entityLabel: r.entity === 'Staff' && r.entityId ? (nameOf.get(r.entityId) ?? null) : null,
        before: r.before,
        after: r.after,
        ip: r.ip,
        userAgent: r.userAgent,
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Staff who appear as actors (audit filter options), including deactivated staff. */
  async actors(): Promise<AuditActorDto[]> {
    return this.prisma.staff.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Distinct entity names for the filter. */
  async entities(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
    });
    return rows.map((r) => r.entity);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(redact(value), (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime()))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { createdAt, id };
}
