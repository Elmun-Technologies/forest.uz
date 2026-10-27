import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

/**
 * Boots the real AppModule against the Testcontainers DB/Redis. `env` overrides the defaults
 * (e.g. PROVIDERS_MODE=sandbox to exercise real provider adapters).
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<NestExpressApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    PROVIDERS_MODE: 'fake',
    DEV_ENDPOINTS: 'true',
    S3_PUBLIC_URL: 'http://cdn.test/forest-public',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

let ipSeq = 0;
const ipBase = Math.floor(Math.random() * 200);

/** A distinct client IP per call: per-IP rate limits live in a Redis shared by all test files. */
export function nextTestIp(): string {
  ipSeq++;
  return `10.${ipBase}.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`;
}

/** A cookie-keeping browser with its own client IP (checkout is limited per IP). */
export function shopper(app: NestExpressApplication): ReturnType<typeof request.agent> {
  return request.agent(app.getHttpServer()).set('X-Forwarded-For', nextTestIp());
}
