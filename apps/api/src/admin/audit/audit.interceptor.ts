import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AUDIT_ACTOR, type AdminRequest } from '../admin-access';
import { isSafeMethod } from '../auth/csrf';

/**
 * docs/02: every admin mutation → AuditLog. After a successful non-GET admin request, checks that
 * the handler recorded an audit row (via `AuditService` with the request's `@Actor()`). A miss is a
 * bug: it throws under tests (so the suite fails) and is logged as an error elsewhere.
 */
@Injectable()
export class AuditEnforcementInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AdminAudit');

  constructor(@Inject(ENV) private readonly env: Env) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    if (isSafeMethod(req.method)) return next.handle();
    return next.handle().pipe(
      tap(() => {
        if (req[AUDIT_ACTOR]?.audited) return;
        const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
        if (this.env.NODE_ENV === 'test') throw new Error(`admin mutation without audit: ${route}`);
        this.logger.error(`admin mutation without audit row: ${route}`);
      }),
    );
  }
}
