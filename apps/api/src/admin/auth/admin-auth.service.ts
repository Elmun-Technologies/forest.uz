import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AcceptInviteInput,
  type AdminLoginInput,
  type AdminMeDto,
  DomainError,
  type InviteInfoDto,
  isStaffRole,
  passwordProblems,
  ROLE_PERMISSIONS,
  type StaffRole,
  type TotpSetupDto,
  totpRequired,
} from '@forest/contracts';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RateLimiter } from '../../customer/common/rate-limit';
import { keyringFromEnv, SecretBox } from '../../integrations/crypto/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminContext } from '../admin-access';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AdminSessionService, sessionStage } from './admin-session.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/** Login hardening (docs/14), kept together like `OTP_POLICY` / `CHECKOUT_POLICY`. */
export const ADMIN_AUTH_POLICY = {
  /** Consecutive password/TOTP failures before the account locks (docs/14: 10). */
  maxFailures: 10,
  lockMinutes: 15,
  /** Login + TOTP + invite attempts per client IP. */
  ipLimit: 20,
  ipWindowSec: 15 * 60,
  inviteTtlHours: 72,
  totpIssuer: 'Forest Admin',
} as const;

const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  totpEnabled: boolean;
}

@Injectable()
export class AdminAuthService {
  private readonly box: SecretBox;
  /** argon2 hash of a random string: unknown emails still pay for one verify (no timing oracle). */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(keyringFromEnv(env));
  }

  // ───────── password step ─────────

  async login(
    input: AdminLoginInput,
    actor: AuditActor,
    req: Request,
    res: Response,
  ): Promise<AdminMeDto> {
    await this.limitIp(actor);
    const staff = await this.prisma.staff.findUnique({ where: { email: input.email } });
    const passwordOk = await this.verifyPassword(staff?.passwordHash ?? null, input.password);
    const usable =
      staff?.active &&
      staff.passwordHash &&
      isStaffRole(staff.role) &&
      !isLocked(staff.lockedUntil);
    if (!staff || !usable || !passwordOk) {
      if (staff && usable) await this.recordFailure(staff.id, actor, 'password');
      // Same write cost for unknown / unusable accounts: no timing hint that the email exists.
      else await this.prisma.staff.updateMany({ where: { id: '' }, data: { failedLogins: 0 } });
      throw new DomainError('ADMIN_LOGIN_FAILED');
    }
    const row = toStaffRow(staff);
    // The failure counter covers password *and* TOTP: it resets only when the login is complete
    // (here when no TOTP step follows, else in verifyTotp) — a password holder must not get a
    // fresh set of TOTP guesses by logging in again.
    if (sessionStage(row, false) === 'full')
      await this.prisma.staff.update({
        where: { id: staff.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    return this.startSession(row, false, actor, req, res, 'password');
  }

  // ───────── TOTP ─────────

  /** New pending secret (TOTP not yet enabled). Returned once; never readable afterwards. */
  async setupTotp(ctx: AdminContext, actor: AuditActor): Promise<TotpSetupDto> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: ctx.staff.id } });
    if (staff.totpEnabled) throw new DomainError('ADMIN_TOTP_ALREADY_ENABLED');
    const secret = generateTotpSecret();
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staff.id },
        data: {
          totpSecret: new Uint8Array(this.box.encrypt(secret, totpAad(staff.id))),
          totpLastUsedStep: null,
        },
      });
      await this.audit.record(
        actor,
        { action: 'staff.totp_setup_started', entity: 'Staff', entityId: staff.id },
        tx,
      );
    });
    return { secret, otpauthUri: otpauthUri(ADMIN_AUTH_POLICY.totpIssuer, staff.email, secret) };
  }

  /**
   * Verifies a code: completes the login step-up (`totp` stage) or the enrolment (pending secret).
   * Either way the session is rotated with TOTP marked verified.
   */
  async verifyTotp(
    ctx: AdminContext,
    code: string,
    actor: AuditActor,
    res: Response,
  ): Promise<AdminMeDto> {
    await this.limitIp(actor);
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: ctx.staff.id } });
    if (!staff.totpSecret) throw new DomainError('ADMIN_TOTP_NOT_STARTED');
    const secret = this.box.decrypt(staff.totpSecret, totpAad(staff.id)).toString('utf8');
    const step = verifyTotp(secret, code, Date.now(), staff.totpLastUsedStep);
    if (step === null) {
      await this.recordFailure(staff.id, actor, 'totp');
      throw new DomainError('ADMIN_TOTP_INVALID');
    }
    const enrolling = !staff.totpEnabled;
    const completesLogin = ctx.stage !== 'full';
    await this.prisma.$transaction(async (tx) => {
      // Replay guard: only a step newer than the last accepted one may win (concurrent requests
      // with the same code race on this conditional update; one gets count 0).
      const won = await tx.staff.updateMany({
        where: {
          id: staff.id,
          OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
        },
        data: {
          totpLastUsedStep: step,
          totpEnabled: true,
          failedLogins: 0,
          lockedUntil: null,
          ...(completesLogin ? { lastLoginAt: new Date() } : {}),
        },
      });
      if (won.count === 0) throw new DomainError('ADMIN_TOTP_INVALID');
      if (enrolling)
        await this.audit.record(
          actor,
          { action: 'staff.totp_enabled', entity: 'Staff', entityId: staff.id },
          tx,
        );
      if (completesLogin)
        await this.audit.record(
          actor,
          { action: 'auth.login', entity: 'Staff', entityId: staff.id, after: { method: 'totp' } },
          tx,
        );
      if (!enrolling && !completesLogin)
        await this.audit.record(
          actor,
          { action: 'auth.totp_reverified', entity: 'Staff', entityId: staff.id },
          tx,
        );
    });
    const row = { ...ctx.staff, totpEnabled: true };
    await this.sessions.create(res, {
      staffId: row.id,
      totpVerified: true,
      stage: 'full',
      previousId: ctx.sessionId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return me(row, 'full');
  }

  // ───────── invites ─────────

  async inviteInfo(token: string): Promise<InviteInfoDto> {
    const invite = await this.openInvite(token);
    return {
      name: invite.staff.name,
      email: invite.staff.email,
      role: invite.staff.role,
      totpRequired: totpRequired(invite.staff.role),
    };
  }

  async acceptInvite(
    input: AcceptInviteInput,
    actor: AuditActor,
    req: Request,
    res: Response,
  ): Promise<AdminMeDto> {
    await this.limitIp(actor);
    const invite = await this.openInvite(input.token);
    const problems = passwordProblems(input.password, invite.staff);
    if (problems.length) throw new DomainError('ADMIN_PASSWORD_WEAK', { problems }, 'password');
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.staffInvite.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      const set = await tx.staff.updateMany({
        where: { id: invite.staff.id, passwordHash: null, active: true },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      });
      if (used.count === 0 || set.count === 0) throw new DomainError('ADMIN_INVITE_INVALID');
      await this.audit.record(
        actor,
        {
          staffId: invite.staff.id,
          action: 'staff.invite_accepted',
          entity: 'Staff',
          entityId: invite.staff.id,
        },
        tx,
      );
    });
    return this.startSession(invite.staff, false, actor, req, res, 'invite', true);
  }

  private async openInvite(token: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        staff: {
          select: { id: true, name: true, email: true, role: true, totpEnabled: true },
        },
      },
    });
    const valid =
      invite &&
      !invite.usedAt &&
      !invite.revokedAt &&
      invite.expiresAt > new Date() &&
      isStaffRole(invite.staff.role);
    if (!valid) throw new DomainError('ADMIN_INVITE_INVALID');
    const staff = await this.prisma.staff.findUnique({
      where: { id: invite.staffId },
      select: { active: true, passwordHash: true },
    });
    if (!staff?.active || staff.passwordHash) throw new DomainError('ADMIN_INVITE_INVALID');
    return { ...invite, staff: toStaffRow(invite.staff) };
  }

  // ───────── session ─────────

  me(ctx: AdminContext): AdminMeDto {
    return me(ctx.staff, ctx.stage);
  }

  async logout(ctx: AdminContext, actor: AuditActor, req: Request, res: Response): Promise<void> {
    await this.audit.record(actor, {
      action: 'auth.logout',
      entity: 'Staff',
      entityId: ctx.staff.id,
    });
    await this.sessions.destroy(req, res, ctx.staff.id);
  }

  /**
   * Opens a session after a password step (login or invite). Full sessions are audited as a login;
   * partial ones record the next step so the trail shows every password success with IP/device.
   */
  private async startSession(
    staff: StaffRow,
    totpVerified: boolean,
    actor: AuditActor,
    req: Request,
    res: Response,
    method: 'password' | 'invite',
    alreadyAudited = false,
  ): Promise<AdminMeDto> {
    const stage = sessionStage(staff, totpVerified);
    const previous = await this.sessions.read(req);
    await this.sessions.create(res, {
      staffId: staff.id,
      totpVerified,
      stage,
      previousId: previous?.id ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    if (stage === 'full')
      await this.prisma.staff.update({
        where: { id: staff.id },
        data: { lastLoginAt: new Date() },
      });
    if (!alreadyAudited || stage === 'full')
      await this.audit.record(actor, {
        staffId: staff.id,
        action: stage === 'full' ? 'auth.login' : 'auth.password_verified',
        entity: 'Staff',
        entityId: staff.id,
        after: { method, ...(stage === 'full' ? {} : { next: stage }) },
      });
    return me(staff, stage);
  }

  // ───────── hardening ─────────

  private async limitIp(actor: AuditActor): Promise<void> {
    await this.limiter.consume(
      'admin-auth-ip',
      actor.ip ?? 'unknown',
      ADMIN_AUTH_POLICY.ipLimit,
      ADMIN_AUTH_POLICY.ipWindowSec,
    );
  }

  private async verifyPassword(hash: string | null, password: string): Promise<boolean> {
    this.dummyHash ??= argon2.hash(`dummy:${Math.random()}:${Date.now()}`, ARGON2_OPTIONS);
    try {
      const ok = await argon2.verify(hash ?? (await this.dummyHash), password);
      return hash !== null && ok;
    } catch {
      // Malformed stored hash: treat as a wrong password.
      return false;
    }
  }

  /**
   * Counts a failed password/TOTP attempt (audited `staff.login_failed` with the step and count —
   * never the typed value); the 10th locks the account and ends its sessions. Unknown e-mails are
   * not audited: there is no staff row to attach them to and storing the e-mail would keep typos.
   */
  private async recordFailure(
    staffId: string,
    actor: AuditActor,
    step: 'password' | 'totp',
  ): Promise<void> {
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.staff.update({
        where: { id: staffId },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      await this.audit.record(
        { ...actor, staffId: null },
        {
          action: 'staff.login_failed',
          entity: 'Staff',
          entityId: staffId,
          after: { step, failures: updated.failedLogins },
        },
        tx,
      );
      return updated;
    });
    if (row.failedLogins < ADMIN_AUTH_POLICY.maxFailures) return;
    const lockedUntil = new Date(Date.now() + ADMIN_AUTH_POLICY.lockMinutes * 60_000);
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { failedLogins: 0, lockedUntil },
    });
    await this.audit.record(
      { ...actor, staffId: null },
      {
        action: 'staff.login_locked',
        entity: 'Staff',
        entityId: staffId,
        after: { lockedUntil: lockedUntil.toISOString(), failures: ADMIN_AUTH_POLICY.maxFailures },
      },
    );
    await this.sessions.destroyAll(staffId);
  }
}

function isLocked(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil > new Date();
}

export function totpAad(staffId: string): string {
  return `staff-totp:${staffId}`;
}

function toStaffRow(staff: {
  id: string;
  name: string;
  email: string;
  role: string;
  totpEnabled: boolean;
}): StaffRow {
  if (!isStaffRole(staff.role)) throw new DomainError('FORBIDDEN');
  return { ...staff, role: staff.role };
}

function me(staff: StaffRow, stage: AdminMeDto['stage']): AdminMeDto {
  return {
    staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    stage,
    permissions: stage === 'full' ? [...ROLE_PERMISSIONS[staff.role]] : [],
    totp: { enabled: staff.totpEnabled, required: totpRequired(staff.role) },
  };
}
