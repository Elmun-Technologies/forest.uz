import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

/**
 * Starts throwaway Postgres + Redis (Testcontainers), applies migrations and the seed once
 * for the integration project. Tests get connection URLs through `inject()`.
 */
let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  pg = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('forest').start();
  redis = await new RedisContainer('redis:7-alpine').start();
  const databaseUrl = pg.getConnectionUri();
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  const env = { ...process.env, DATABASE_URL: databaseUrl, S3_ENDPOINT: '', NODE_ENV: 'test' };
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbDir, env, stdio: 'pipe' });
  execFileSync('pnpm', ['exec', 'tsx', 'src/seed/index.ts'], { cwd: dbDir, env, stdio: 'pipe' });
  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await Promise.all([pg?.stop(), redis?.stop()]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
