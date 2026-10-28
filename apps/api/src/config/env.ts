import { z } from 'zod';

const base64Key = z
  .string()
  .refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    'must be 32 bytes, base64 (openssl rand -base64 32)',
  );

/** Comma-separated base64 keys (empty = none), each 32 bytes; at most 5. */
const base64KeyList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  )
  .pipe(z.array(base64Key).max(5));

/** An optional ≥ 32-char secret; an empty value (`KEY=` in .env) counts as unset. */
const optionalSecret = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(32).optional(),
);

/** Validated process environment. Integration credentials are NOT here — they live encrypted in the DB. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /**
   * Proxy hops in front of the API whose X-Forwarded-For entries are trusted (Express
   * `trust proxy`). 1 = Caddy only (Caddy replaces untrusted XFF); 2 = Cloudflare → Caddy, with
   * Caddy's `trusted_proxies` set to Cloudflare's ranges. Rate limits key on this client IP.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /**
   * Shared secret the storefront/admin middleware sends as `X-Forest-Edge` on proxied `/api/*`
   * calls (demo: Vercel → Fly, no Caddy). When set, requests without the matching header keep only
   * the last X-Forwarded-For entry (the real peer), so a direct caller can't pick its client IP.
   * Unset (compose/dev) = X-Forwarded-For handled by TRUST_PROXY_HOPS alone.
   */
  EDGE_PROXY_SECRET: optionalSecret,
  APP_URL: z.url().default('http://localhost:3000'),
  ADMIN_URL: z.url().default('http://localhost:3001'),
  API_URL: z.url().default('http://localhost:4000'),
  /**
   * Where the API reaches the storefront server for on-demand revalidation (`POST /api/revalidate`).
   * Default APP_URL (dev); compose sets the internal `http://web:3000`. Tests set it only when they
   * stub the web endpoint.
   */
  WEB_INTERNAL_URL: z.url().optional(),
  /**
   * Shared secret of the signed API ↔ storefront calls (revalidation, 404 reports); ≥ 32 random
   * chars, same value in api and web. Missing in production = those calls are refused (fail
   * closed); dev/test derive one from APP_ENCRYPTION_KEY.
   */
  WEB_REVALIDATE_SECRET: z.string().min(32).optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /**
   * Finished BullMQ jobs kept per queue (inspection/debugging). The free demo's 25 MB in-memory
   * Redis needs far fewer than the VPS default.
   */
  JOBS_KEEP_COMPLETED: z.coerce.number().int().min(0).default(1000),
  JOBS_KEEP_FAILED: z.coerce.number().int().min(0).default(5000),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  /**
   * Path-style bucket addressing (`<endpoint>/<bucket>/<key>`): SeaweedFS/MinIO need it; Tigris
   * (demo on Fly) refuses it for buckets created since 2025-02 → `false` (virtual-hosted).
   */
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  S3_BUCKET_PUBLIC: z.string().default('forest-public'),
  S3_BUCKET_PRIVATE: z.string().default('forest-private'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_PUBLIC_URL: z.string().default('http://localhost:9000/forest-public'),
  APP_ENCRYPTION_KEY: base64Key,
  /**
   * Earlier master keys, kept only for decryption while `rotate-keys` re-seals stored secrets
   * with APP_ENCRYPTION_KEY (docs/runbooks/secret-rotation.md §1). Remove once it reports 0 left.
   */
  APP_ENCRYPTION_KEY_PREVIOUS: base64KeyList,
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
  /**
   * `X-Dev-Token` for the dev endpoints (all but the narrow public OTP lookup
   * `GET /dev/outbox?to=`). Required in production (unset = those endpoints 404); outside
   * production enforced when set (dev.mjs generates one).
   */
  DEV_ENDPOINTS_TOKEN: optionalSecret,
  /** `POST /dev/admin-totp` with NODE_ENV=production (CI e2e only; never on the public demo). */
  ALLOW_DEV_ADMIN_TOTP: z.stringbool().default(false),
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  GEOIP_DB_PATH: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default(''),
  /**
   * Yandex Delivery API root. Only tests (local stub server) override it — the OAuth token from the
   * integration credentials is sent to this host.
   */
  YANDEX_DELIVERY_API_URL: z.url().default('https://b2b.taxi.yandex.net'),
  /** Eskiz SMS API root (same reason: only tests point it at a stub; the password goes there). */
  ESKIZ_API_URL: z.url().default('https://notify.eskiz.uz/api'),
  /** MoySklad JSON API root (only tests point it at a stub; the Bearer token goes there). */
  MOYSKLAD_API_URL: z.url().default('https://api.moysklad.ru/api/remap/1.2'),
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
