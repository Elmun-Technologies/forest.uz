import type { AdminStage, Permission, StaffRole } from '@forest/contracts';
import type { Request } from 'express';
import type { AuditActor } from './audit/audit.service';
import type { AdminSessionData } from './auth/admin-session.service';

/**
 * Route access metadata for `/v1/admin/*` (default-deny, CLAUDE.md §6). Every admin route carries
 * exactly one of: `@RequirePermissions(...)`, or — auth controller only — `@AdminPublic()` /
 * `@AdminSession(...)`.
 */
export const PERMISSIONS_KEY = 'forest:admin:permissions';
export const ADMIN_ACCESS_KEY = 'forest:admin:access';

export type AdminAccess = { kind: 'public' } | { kind: 'session'; stages: AdminStage[] };

export interface AdminStaff {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  totpEnabled: boolean;
}

/** Resolved by `AdminAuthGuard` for every non-public admin route. */
export interface AdminContext {
  staff: AdminStaff;
  sessionId: string;
  session: AdminSessionData;
  stage: AdminStage;
  permissions: readonly Permission[];
}

export const ADMIN_CTX = Symbol('adminContext');
export const AUDIT_ACTOR = Symbol('auditActor');

export type AdminRequest = Request & {
  [ADMIN_CTX]?: AdminContext;
  [AUDIT_ACTOR]?: AuditActor;
};

export function adminContext(req: AdminRequest): AdminContext {
  const ctx = req[ADMIN_CTX];
  // Fail loudly: a route without AdminAuthGuard must never act as some staff member.
  if (!ctx) throw new Error('@Admin()/@AdminId() need AdminAuthGuard (use @AdminController)');
  return ctx;
}

/** The request's audit actor (staff id when signed in, IP, user agent), created once. */
export function auditActor(req: AdminRequest): AuditActor {
  req[AUDIT_ACTOR] ??= {
    staffId: req[ADMIN_CTX]?.staff.id ?? null,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    audited: false,
  };
  return req[AUDIT_ACTOR];
}
