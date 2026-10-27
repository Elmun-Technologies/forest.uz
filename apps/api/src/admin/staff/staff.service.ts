import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  isStaffRole,
  maskUzPhone,
  type StaffDto,
  type StaffInviteInput,
  type StaffInviteResultDto,
  type StaffUpdateInput,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { ADMIN_AUTH_POLICY, hashInviteToken } from '../auth/admin-auth.service';
import { AdminSessionService } from '../auth/admin-session.service';

const staffSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  totpEnabled: true,
  passwordHash: true,
  lastLoginAt: true,
  createdAt: true,
  invites: {
    where: { usedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.StaffSelect;

type StaffRecord = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

/** A16 Staff tab: list, invite (one-time link), role/active changes, TOTP reset. Owner-only. */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: AdminSessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(): Promise<StaffDto[]> {
    const rows = await this.prisma.staff.findMany({
      select: staffSelect,
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async invite(actor: AuditActor, input: StaffInviteInput): Promise<StaffInviteResultDto> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ADMIN_AUTH_POLICY.inviteTtlHours * 3600_000);
    try {
      const staff = await this.prisma.$transaction(async (tx) => {
        const created = await tx.staff.create({
          data: {
            name: input.name,
            email: input.email,
            role: input.role,
            phone: input.phone ?? null,
            passwordHash: null,
          },
        });
        await tx.staffInvite.create({
          data: {
            staffId: created.id,
            tokenHash: hashInviteToken(token),
            expiresAt,
            createdById: actor.staffId,
          },
        });
        // The link itself is never logged: whoever holds it can set the password.
        await this.audit.record(
          actor,
          {
            action: 'staff.invite',
            entity: 'Staff',
            entityId: created.id,
            after: { name: input.name, email: input.email, role: input.role, expiresAt },
          },
          tx,
        );
        return tx.staff.findUniqueOrThrow({ where: { id: created.id }, select: staffSelect });
      });
      return {
        staff: toDto(staff),
        inviteUrl: this.inviteUrl(token),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new DomainError('ADMIN_STAFF_EXISTS', undefined, 'email');
      throw e;
    }
  }

  /** New link for a staff member who hasn't accepted yet; older links stop working. */
  async reissueInvite(actor: AuditActor, id: string): Promise<StaffInviteResultDto> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ADMIN_AUTH_POLICY.inviteTtlHours * 3600_000);
    const staff = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.staff.findUnique({ where: { id } });
      if (!row) throw new DomainError('NOT_FOUND');
      if (row.passwordHash) throw new DomainError('ADMIN_INVITE_NOT_PENDING');
      await tx.staffInvite.updateMany({
        where: { staffId: id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.staffInvite.create({
        data: {
          staffId: id,
          tokenHash: hashInviteToken(token),
          expiresAt,
          createdById: actor.staffId,
        },
      });
      await this.audit.record(
        actor,
        { action: 'staff.invite_reissued', entity: 'Staff', entityId: id, after: { expiresAt } },
        tx,
      );
      return tx.staff.findUniqueOrThrow({ where: { id }, select: staffSelect });
    });
    return {
      staff: toDto(staff),
      inviteUrl: this.inviteUrl(token),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async update(actor: AuditActor, id: string, input: StaffUpdateInput): Promise<StaffDto> {
    if (id === actor.staffId && (input.role !== undefined || input.active !== undefined))
      throw new DomainError('ADMIN_SELF_CHANGE');
    const { row, deactivated } = await this.prisma.$transaction(async (tx) => {
      // Lock the owners first (fixed order) so two concurrent demotions can't both pass the
      // "another active owner remains" check.
      await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "role" = 'OWNER' ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${id} FOR UPDATE`;
      const before = await tx.staff.findUnique({ where: { id }, select: staffSelect });
      if (!before) throw new DomainError('NOT_FOUND');
      const losesOwner =
        before.role === 'OWNER' &&
        before.active &&
        ((input.role !== undefined && input.role !== 'OWNER') || input.active === false);
      if (losesOwner) {
        const others = await tx.staff.count({
          where: { id: { not: id }, role: 'OWNER', active: true, passwordHash: { not: null } },
        });
        if (others === 0) throw new DomainError('ADMIN_LAST_OWNER');
      }
      const after = await tx.staff.update({ where: { id }, data: input, select: staffSelect });
      const changed = (Object.keys(input) as (keyof StaffUpdateInput)[]).filter(
        (k) => before[k] !== after[k],
      );
      await this.audit.record(
        actor,
        {
          action: 'staff.update',
          entity: 'Staff',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        },
        tx,
      );
      return { row: after, deactivated: before.active && !after.active };
    });
    if (deactivated) await this.sessions.destroyAll(id);
    return toDto(row);
  }

  /** Lost phone: clears TOTP; the staff member enrols again at next login (Owner/Manager must). */
  async resetTotp(actor: AuditActor, id: string): Promise<StaffDto> {
    if (id === actor.staffId) throw new DomainError('ADMIN_SELF_CHANGE');
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({ where: { id }, select: { totpEnabled: true } });
      if (!before) throw new DomainError('NOT_FOUND');
      const after = await tx.staff.update({
        where: { id },
        data: { totpSecret: null, totpEnabled: false, totpLastUsedStep: null },
        select: staffSelect,
      });
      await this.audit.record(
        actor,
        {
          action: 'staff.totp_reset',
          entity: 'Staff',
          entityId: id,
          before: { totpEnabled: before.totpEnabled },
          after: { totpEnabled: false },
        },
        tx,
      );
      return after;
    });
    await this.sessions.destroyAll(id);
    return toDto(row);
  }

  private inviteUrl(token: string): string {
    return `${this.env.ADMIN_URL.replace(/\/+$/, '')}/invite/${token}`;
  }
}

function toDto(s: StaffRecord): StaffDto {
  if (!isStaffRole(s.role)) throw new DomainError('INTERNAL');
  const pending = s.passwordHash === null;
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone ? maskUzPhone(s.phone) : null,
    role: s.role,
    active: s.active,
    totpEnabled: s.totpEnabled,
    invitePending: pending,
    inviteExpiresAt: pending ? (s.invites[0]?.expiresAt.toISOString() ?? null) : null,
    lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
