import { type INestApplication, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { edgeProxyGate } from './common/edge-proxy';
import { ApiExceptionFilter, jsonReplacer } from './common/http';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { sessionSecrets } from './config/session-secrets';

/** API paths whose responses depend on who asks (sessions, cookies, keys) or carry tokens. */
export const PRIVATE_PATH =
  /^\/v1\/(admin|auth|cart|checkout|me|orders|track|partner|dev|bot|messaging|t|webhooks)(\/|$)/;

/** Shared by main.ts and integration tests so tests exercise the real HTTP pipeline. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.EDGE_PROXY_SECRET) app.use(edgeProxyGate(env.EDGE_PROXY_SECRET));
  app.set('json replacer', jsonReplacer);
  app.disable('x-powered-by');
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }),
  );
  app.use(cookieParser(sessionSecrets(env)));
  app.enableCors({ origin: [env.APP_URL, env.ADMIN_URL], credentials: true });
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  // Responses are localized from Accept-Language and cached publicly → caches must key on it.
  app.use((_req: unknown, res: { vary: (field: string) => void }, next: () => void) => {
    res.vary('Accept-Language');
    next();
  });
  // ASVS F-09: personal and authenticated responses are never stored by a browser or proxy cache
  // unless a route sets its own Cache-Control (set later by the handler, so it wins).
  app.use(
    (
      req: { path: string },
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      if (PRIVATE_PATH.test(req.path)) res.setHeader('Cache-Control', 'private, no-store');
      next();
    },
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
