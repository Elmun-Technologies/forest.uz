import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, isStaffRole, type Permission, ROLE_PERMISSIONS } from '@forest/contracts';
import type { Response } from 'express';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_ACCESS_KEY,
  ADMIN_CTX,
  type AdminAccess,
  type AdminRequest,
  PERMISSIONS_KEY,
} from '../admin-access';
import { AdminSessionService, sessionStage } from './admin-session.service';
import { checkCsrf, CSRF_COOKIE, CSRF_HEADER } from './csrf';

function access(reflector: Reflector, ctx: ExecutionContext): AdminAccess | undefined {
  return reflector.getAllAndOverride<AdminAccess | undefined>(ADMIN_ACCESS_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
}

function requiredPermissions(
  reflector: Reflector,
  ctx: ExecutionContext,
): Permission[] | undefined {
  return reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
}

/**
 * Double-submit CSRF check on every state-changing admin request (session binding is checked by
 * `AdminAuthGuard`, which loads the session). Runs first, so a forged request fails before any
 * work, logged in or not.
 */
@Injectable()
export class AdminCsrfGuard implements CanActivate {
  private readonly adminOrigin: string;

  constructor(@Inject(ENV) env: Env) {
    this.adminOrigin = new URL(env.ADMIN_URL).origin;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const verdict = checkCsrf({
      method: req.method,
      header: req.headers[CSRF_HEADER],
      cookie: (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE],
      bound: null,
      origin: req.headers.origin,
      adminOrigin: this.adminOrigin,
    });
    if (verdict !== 'ok') throw new DomainError('ADMIN_CSRF_INVALID', { reason: verdict });
    return true;
  }
}

/**
 * Session + TOTP step: resolves the staff member from `fr_admin` (Staff row re-read every time, so
 * role/active/TOTP changes apply at once) and stores the `AdminContext` on the request. Sessions
 * that haven't satisfied TOTP reach only routes marked `@AdminSession('totp' | 'setup')`.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AdminSessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = access(this.reflector, ctx);
    if (rule?.kind === 'public') return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<AdminRequest>();
    const session = await this.sessions.read(req);
    if (!session) throw new DomainError('UNAUTHORIZED');
    const staff = await this.prisma.staff.findUnique({
      where: { id: session.data.staffId },
      select: { id: true, name: true, email: true, role: true, totpEnabled: true, active: true },
    });
    if (!staff?.active || !isStaffRole(staff.role)) {
      await this.sessions.destroy(req, http.getResponse<Response>(), session.data.staffId);
      throw new DomainError('UNAUTHORIZED');
    }
    const verdict = checkCsrf({
      method: req.method,
      header: req.headers[CSRF_HEADER],
      cookie: (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE],
      bound: session.data.csrf,
      origin: undefined,
      adminOrigin: '',
    });
    if (verdict !== 'ok') throw new DomainError('ADMIN_CSRF_INVALID', { reason: verdict });

    const stage = sessionStage(staff, session.data.totpVerified);
    const allowed = rule?.kind === 'session' ? rule.stages : ['full'];
    if (!allowed.includes(stage))
      throw new DomainError(stage === 'totp' ? 'ADMIN_TOTP_REQUIRED' : 'ADMIN_TOTP_SETUP_REQUIRED');
    req[ADMIN_CTX] = {
      staff: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        totpEnabled: staff.totpEnabled,
      },
      sessionId: session.id,
      session: session.data,
      stage,
      permissions: stage === 'full' ? ROLE_PERMISSIONS[staff.role] : [],
    };
    return true;
  }
}

/**
 * Permission check, deny by default: a route with neither `@RequirePermissions` nor an explicit
 * public/session marker is refused (and logged), so a forgotten decorator can't open an endpoint.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger('AdminRbac');

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (access(this.reflector, ctx)) return true;
    const required = requiredPermissions(this.reflector, ctx);
    if (!required?.length) {
      this.logger.error(
        `admin route without @RequirePermissions: ${ctx.getClass().name}.${ctx.getHandler().name}`,
      );
      throw new DomainError('FORBIDDEN');
    }
    const granted = ctx.switchToHttp().getRequest<AdminRequest>()[ADMIN_CTX]?.permissions ?? [];
    if (!required.every((p) => granted.includes(p))) throw new DomainError('FORBIDDEN');
    return true;
  }
}
