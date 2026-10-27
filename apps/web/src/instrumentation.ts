import type { ErrorReporter } from '@forest/contracts';
import type { Instrumentation } from 'next';

/**
 * Server-side render/route errors → self-hosted GlitchTip (CLAUDE.md §6 "Error monitoring").
 * Off unless the runtime env has SENTRY_DSN. Sends the route *template* (`context.routePath`),
 * method and digest only — never the concrete path, headers, cookies or body (the reporter in
 * `@forest/contracts` decides what an event may hold). Browser errors are not collected.
 */
export function register(): void {}

let reporter: Promise<ErrorReporter> | null = null;

function getReporter(): Promise<ErrorReporter> {
  // Loaded lazily so the reporter stays out of every request path until an error happens.
  reporter ??= import('@forest/contracts').then(({ createErrorReporter }) =>
    createErrorReporter({
      dsn: process.env.SENTRY_DSN ?? '',
      service: 'web',
      release: process.env.FOREST_RELEASE || undefined,
      environment: process.env.NODE_ENV,
    }),
  );
  return reporter;
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  try {
    const r = await getReporter();
    const digest = (err as { digest?: unknown }).digest;
    r.capture(err, {
      route: context.routePath,
      method: request.method,
      tags: {
        routeType: context.routeType,
        routerKind: context.routerKind,
        ...(typeof digest === 'string' ? { digest } : {}),
      },
    });
  } catch {
    // Monitoring must never turn one error into two.
  }
};
