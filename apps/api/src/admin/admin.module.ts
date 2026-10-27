import { Global, Module } from '@nestjs/common';
import { RateLimiter } from '../customer/common/rate-limit';
import { AdminAuditController } from './audit/audit.controller';
import { AuditEnforcementInterceptor } from './audit/audit.interceptor';
import { AuditService } from './audit/audit.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthGuard, AdminCsrfGuard, PermissionsGuard } from './auth/admin.guard';
import { AdminSessionService } from './auth/admin-session.service';
import { DevAdminController } from './auth/dev-admin.controller';
import { AdminStaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';

/**
 * Admin building blocks every admin controller needs (guards' dependencies, audit). Global so
 * later domain modules (orders, products…) can use `@AdminController` without re-wiring.
 */
@Global()
@Module({
  providers: [
    AdminSessionService,
    AuditService,
    AdminCsrfGuard,
    AdminAuthGuard,
    PermissionsGuard,
    AuditEnforcementInterceptor,
  ],
  exports: [
    AdminSessionService,
    AuditService,
    AdminCsrfGuard,
    AdminAuthGuard,
    PermissionsGuard,
    AuditEnforcementInterceptor,
  ],
})
export class AdminCoreModule {}

/** `/v1/admin/*`: auth (password + TOTP), staff (A16), audit log (Phase 3 foundation). */
@Module({
  imports: [AdminCoreModule],
  controllers: [
    AdminAuthController,
    AdminStaffController,
    AdminAuditController,
    DevAdminController,
  ],
  providers: [AdminAuthService, StaffService, RateLimiter],
})
export class AdminModule {}
