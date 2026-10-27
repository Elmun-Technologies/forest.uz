import {
  applyDecorators,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AdminStage, Permission } from '@forest/contracts';
import {
  ADMIN_ACCESS_KEY,
  type AdminAccess,
  type AdminContext,
  adminContext,
  type AdminRequest,
  auditActor,
  PERMISSIONS_KEY,
} from './admin-access';
import { AuditEnforcementInterceptor } from './audit/audit.interceptor';
import type { AuditActor } from './audit/audit.service';
import { AdminAuthGuard, AdminCsrfGuard, PermissionsGuard } from './auth/admin.guard';

/** Full session (TOTP satisfied) holding every listed permission. */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** No session needed (login, invite acceptance, CSRF bootstrap). Auth controller only. */
export const AdminPublic = () => SetMetadata(ADMIN_ACCESS_KEY, { kind: 'public' } as AdminAccess);

/**
 * Any session, also before TOTP is satisfied in the listed stages (me, logout, TOTP routes);
 * no permission needed. Auth controller only.
 */
export const AdminSession = (...stages: Exclude<AdminStage, 'full'>[]) =>
  SetMetadata(ADMIN_ACCESS_KEY, { kind: 'session', stages: [...stages, 'full'] } as AdminAccess);

/**
 * `@Controller('admin/<path>')` + the CSRF, session and permission guards + the audit check.
 * Every admin controller must use this instead of `@Controller`.
 */
export const AdminController = (path = '') =>
  applyDecorators(
    Controller(path ? `admin/${path}` : 'admin'),
    UseGuards(AdminCsrfGuard, AdminAuthGuard, PermissionsGuard),
    UseInterceptors(AuditEnforcementInterceptor),
  );

/** `@Admin()` — the resolved admin context (staff, session, stage, permissions). */
export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext =>
  adminContext(ctx.switchToHttp().getRequest<AdminRequest>()),
);

/** `@AdminId()` — the signed-in staff id. */
export const AdminId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    adminContext(ctx.switchToHttp().getRequest<AdminRequest>()).staff.id,
);

/** `@Actor()` — who to record in the audit log for this request. */
export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): AuditActor =>
  auditActor(ctx.switchToHttp().getRequest<AdminRequest>()),
);
