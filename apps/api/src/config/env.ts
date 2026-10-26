import { z } from 'zod';

const base64Key = z
  .string()
  .refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    'must be 32 bytes, base64 (openssl rand -base64 32)',
  );

/** Validated process environment. Integration credentials are NOT here — they live encrypted in the DB. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  ADMIN_URL: z.url().default('http://localhost:3001'),
  API_URL: z.url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_PUBLIC: z.string().default('forest-public'),
  S3_BUCKET_PRIVATE: z.string().default('forest-private'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_PUBLIC_URL: z.string().default('http://localhost:9000/forest-public'),
  APP_ENCRYPTION_KEY: base64Key,
  SESSION_SECRET: z.string().min(32),
  ADMIN_COOKIE_DOMAIN: z.string().default('localhost'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(''),
  PROVIDERS_MODE: z.enum(['fake', 'sandbox', 'live']).default('fake'),
  /** Fake providers in production only for demos/CI (otherwise checkout would hand out fake-pay links). */
  ALLOW_FAKE_PROVIDERS: z.stringbool().default(false),
  /**
   * Dev-only endpoints (fake SMS/Telegram outbox with OTP codes). Requires PROVIDERS_MODE=fake;
   * in production also ALLOW_FAKE_PROVIDERS=true (CI/demos).
   */
  DEV_ENDPOINTS: z.stringbool().default(false),
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  GEOIP_DB_PATH: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.PROVIDERS_MODE === 'fake' && !env.ALLOW_FAKE_PROVIDERS) {
    throw new Error(
      'PROVIDERS_MODE=fake is not allowed in production (set ALLOW_FAKE_PROVIDERS=true only for demos/CI)',
    );
  }
  // A leftover DEV_ENDPOINTS=true from .env.example would publish every OTP code in production.
  if (env.NODE_ENV === 'production' && env.DEV_ENDPOINTS && !env.ALLOW_FAKE_PROVIDERS) {
    throw new Error(
      'DEV_ENDPOINTS=true is not allowed in production (it exposes OTP codes; only with ALLOW_FAKE_PROVIDERS=true for demos/CI)',
    );
  }
  return env;
}
