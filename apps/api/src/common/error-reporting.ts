import { Logger } from '@nestjs/common';
import { createErrorReporter, type ErrorReporter } from '@forest/contracts';
import type { Env } from '../config/env';

/**
 * Server errors → self-hosted GlitchTip (CLAUDE.md §6 "Error monitoring"). Off until `main.ts`
 * calls `initErrorReporting` with a `SENTRY_DSN`; tests never send. What an event may contain is
 * decided by `@forest/contracts` `error-report.ts` (no bodies, headers, cookies, paths, users, IPs).
 */
let reporter: ErrorReporter = createErrorReporter({ dsn: '', service: 'api' });

export function initErrorReporting(env: Env): void {
  const logger = new Logger('ErrorReporting');
  reporter = createErrorReporter({
    dsn: env.SENTRY_DSN,
    service: 'api',
    // Image tag set by infra/deploy/compose.prod.yml (not part of the validated app config).
    release: process.env.FOREST_RELEASE || undefined,
    environment: env.NODE_ENV,
    onSendError: (e) =>
      logger.warn(`error report not sent: ${e instanceof Error ? e.message : 'unknown'}`),
  });
  if (reporter.enabled) logger.log('error reporting on');
}

interface RoutedRequest {
  method?: string;
  route?: { path?: unknown };
  id?: unknown;
}

/** A 5xx answered by `ApiExceptionFilter`: route template only, never the concrete URL. */
export function reportServerError(err: unknown, req: RoutedRequest, status: number): void {
  const route = typeof req.route?.path === 'string' ? req.route.path : '(unmatched)';
  reporter.capture(err, {
    route,
    method: req.method,
    status,
    requestId:
      typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : undefined,
  });
}
