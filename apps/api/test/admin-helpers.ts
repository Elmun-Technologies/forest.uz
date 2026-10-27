import { randomBytes } from 'node:crypto';
import type { AdminMeDto, StaffRole } from '@forest/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { base32Decode, hotp, totpStep } from '../src/admin/auth/totp';
import { PrismaService } from '../src/prisma/prisma.service';
import { nextTestIp } from './app';

/**
 * Boots AppModule (+ optional extra modules, e.g. a probe controller) like `createTestApp`.
 * Kept separate so admin suites can add test-only admin routes.
 */
export async function createAdminTestApp(
  extraModules: (new () => unknown)[] = [],
  env: Record<string, string> = {},
  /** Provider overrides (e.g. an in-memory object store instead of S3). */
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
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
  const moduleRef = await configure(
    Test.createTestingModule({ imports: [AppModule, ...extraModules] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/** Per-run throwaway password (no credential-like literal in the repo for secret scanners). */
export const STRONG_PASSWORD = `test-${randomBytes(9).toString('hex')}-pass`;

let seq = 0;
export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now().toString(36)}-${seq++}@staff.test`.toLowerCase();

export async function createStaff(
  prisma: PrismaService,
  role: StaffRole,
  opts: { password?: string; name?: string; phone?: string } = {},
): Promise<{ id: string; email: string; password: string }> {
  const password = opts.password ?? STRONG_PASSWORD;
  const email = uniqueEmail(role.toLowerCase());
  const row = await prisma.staff.create({
    data: {
      email,
      name: opts.name ?? `${role} tester`,
      role,
      phone: opts.phone ?? null,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  return { id: row.id, email, password };
}

/**
 * A cookie-keeping admin browser with its own client IP. Tracks the CSRF cookie the API hands out
 * and echoes it in `X-CSRF-Token` like the admin UI does.
 */
export class AdminClient {
  readonly agent: ReturnType<typeof request.agent>;
  readonly ip = nextTestIp();
  csrf: string | null = null;
  session: string | null = null;

  constructor(private readonly app: NestExpressApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  private track(res: request.Response): request.Response {
    const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const [name, value] = pair!.split('=');
      if (name === 'fr_admin_csrf') this.csrf = value || null;
      if (name === 'fr_admin') this.session = value || null;
    }
    return res;
  }

  async get(path: string): Promise<request.Response> {
    return this.track(await this.agent.get(path).set('X-Forwarded-For', this.ip));
  }

  async send(
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
    opts: { csrf?: string | null } = {},
  ): Promise<request.Response> {
    if (!this.csrf && opts.csrf === undefined) await this.get('/v1/admin/auth/csrf');
    const req = this.agent[method](path).set('X-Forwarded-For', this.ip);
    const token = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (token) req.set('X-CSRF-Token', token);
    return this.track(await (body ? req.send(body) : req));
  }

  post(path: string, body?: object, opts?: { csrf?: string | null }) {
    return this.send('post', path, body, opts);
  }

  login(email: string, password: string) {
    return this.post('/v1/admin/auth/login', { email, password });
  }
}

/** Code for the next step the replay rule accepts (mirrors POST /dev/admin-totp). */
export async function nextTotpCode(prisma: PrismaService, staffId: string, secret: string) {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
  const current = totpStep(Date.now());
  const step = Math.max(current, (staff.totpLastUsedStep ?? -1) + 1);
  if (step > current + 1) throw new Error('no acceptable TOTP step right now');
  return hotp(base32Decode(secret), step);
}

/** Staff of `role` with a full session (TOTP enrolled when the role requires it). */
export async function signedIn(
  app: NestExpressApplication,
  role: StaffRole,
): Promise<{ client: AdminClient; id: string; email: string; password: string; secret?: string }> {
  const prisma = app.get(PrismaService);
  const staff = await createStaff(prisma, role);
  const client = new AdminClient(app);
  const res = await client.login(staff.email, staff.password);
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const me = res.body as AdminMeDto;
  if (me.stage === 'full') return { client, ...staff };
  const setup = await client.post('/v1/admin/auth/totp/setup');
  const secret = (setup.body as { secret: string }).secret;
  const verify = await client.post('/v1/admin/auth/totp/verify', {
    code: await nextTotpCode(prisma, staff.id, secret),
  });
  if ((verify.body as AdminMeDto).stage !== 'full') throw new Error('TOTP enrolment failed');
  return { client, ...staff, secret };
}
