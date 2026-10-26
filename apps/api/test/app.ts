import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

/** Boots the real AppModule against the Testcontainers DB/Redis. */
export async function createTestApp(): Promise<NestExpressApplication> {
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
