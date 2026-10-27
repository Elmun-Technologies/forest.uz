import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { maskPhonesInText } from '../../common/redact';
import type { HttpClient, HttpResponse } from '../http-client';
import type { HealthResult, SmsProvider } from './types';

/**
 * Eskiz SMS gateway (notify.eskiz.uz). Protocol from the official Postman collection export
 * (mirrored in mlkvdev/eskiz-sms) cross-checked with the eskiz-sms SDKs on PyPI/npm — sources
 * and unverified points in docs/runbooks/messaging-and-fiscal.md.
 *   POST {base}/auth/login          form email, password → { data: { token } }
 *   POST {base}/message/sms/send    Bearer; form mobile_phone (998XXXXXXXXX), message, from,
 *                                   callback_url → { id: <request uuid>, status: "waiting" }
 *   callback (POST to callback_url) { request_id, message_id, phone_number, status, … }
 */
export const ESKIZ_DEFAULT_API_URL = 'https://notify.eskiz.uz/api';

export const ESKIZ_TOKEN_POLICY = {
  /** Renew this long before the token's `exp` so a send never races the expiry. */
  renewBeforeMs: 60 * 60_000,
  /** Lifetime assumed when the token carries no readable `exp` (UNVERIFIED, docs/13). */
  fallbackTtlMs: 24 * 3600_000,
  minTtlMs: 60_000,
  /** Another process holds the login lock: wait this long for its token before logging in. */
  lockMs: 10_000,
  waitStepMs: 200,
} as const;

/** Credentials stored (encrypted) on the `eskiz` integration. */
export interface EskizCredentials {
  email: string;
  password: string;
  from: string;
  /** Per-install secret in the callback URL (Eskiz callbacks are unsigned). */
  callbackToken?: string;
}

export class EskizError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'EskizError';
  }
}

/** E.164 `+998901234567` → `998901234567` (digits only, Uzbek numbers only). */
export function eskizPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (!/^998\d{9}$/.test(digits)) throw new EskizError('not an Uzbek mobile number', null);
  return digits;
}

export function newEskizCallbackToken(): string {
  return randomBytes(32).toString('base64url');
}

export function eskizCallbackTokenMatches(given: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(stored).digest();
  return timingSafeEqual(a, b);
}

/** `exp` (seconds) of a JWT, without verifying it — only used to schedule renewal. */
export function jwtExpiryMs(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/** How long a fresh token may be cached (until `renewBeforeMs` before its expiry). */
export function eskizTokenTtlMs(token: string, now: number): number {
  const exp = jwtExpiryMs(token);
  const ttl = exp
    ? exp - now - ESKIZ_TOKEN_POLICY.renewBeforeMs
    : ESKIZ_TOKEN_POLICY.fallbackTtlMs - ESKIZ_TOKEN_POLICY.renewBeforeMs;
  return Math.max(ESKIZ_TOKEN_POLICY.minTtlMs, ttl);
}

/** Delivery statuses (Postman collection, "СТАТУС СООБЩЕНИЯ" / per-part statuses). */
const DELIVERED = new Set(['DELIVRD', 'DELIVERED', 'PARTDELIVERED']);
const FAILED = new Set(['UNDELIV', 'UNDELIVERABLE', 'EXPIRED', 'REJECTD', 'REJECTED', 'DELETED']);

export type EskizDeliveryOutcome = 'DELIVERED' | 'FAILED' | 'PENDING';

export function eskizOutcome(status: string): EskizDeliveryOutcome {
  const s = status.trim().toUpperCase();
  if (DELIVERED.has(s)) return 'DELIVERED';
  if (FAILED.has(s)) return 'FAILED';
  // NEW, STORED, ACCEPTED, ENROUTE, UNKNOWN, waiting: not final.
  return 'PENDING';
}

export interface EskizCallback {
  requestId: string;
  status: string;
  outcome: EskizDeliveryOutcome;
  statusDate: string | null;
}

/** Callback body (JSON or form). Null when it doesn't look like an Eskiz status callback. */
export function parseEskizCallback(body: unknown): EskizCallback | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const requestId = typeof b.request_id === 'string' ? b.request_id.trim() : '';
  const status = typeof b.status === 'string' ? b.status.trim() : '';
  if (!/^[\w-]{1,64}$/.test(requestId) || !/^[\w ]{1,32}$/.test(status)) return null;
  return {
    requestId,
    status,
    outcome: eskizOutcome(status),
    statusDate: typeof b.status_date === 'string' ? b.status_date.slice(0, 32) : null,
  };
}

// ── Token cache ──

/** The Redis operations the token cache needs (an adapter keeps tests free of ioredis). */
export interface TokenKv {
  get(key: string): Promise<string | null>;
  setPx(key: string, value: string, ms: number): Promise<void>;
  /** SET NX PX — true when this caller took the key. */
  setNxPx(key: string, value: string, ms: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export function redisTokenKv(redis: Redis): TokenKv {
  return {
    get: (k) => redis.get(k),
    setPx: async (k, v, ms) => {
      await redis.set(k, v, 'PX', ms);
    },
    setNxPx: async (k, v, ms) => (await redis.set(k, v, 'PX', ms, 'NX')) === 'OK',
    del: async (k) => {
      await redis.del(k);
    },
  };
}

export type EskizLogin = () => Promise<string>;

/**
 * Bearer token shared by every API process: cached in Redis until shortly before it expires.
 * Single flight: concurrent callers in this process share one login promise; across processes
 * a short Redis lock lets one log in while the others wait for its token.
 */
export class EskizTokenCache {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly kv: TokenKv,
    private readonly opts: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep?.(ms) ?? new Promise((r) => setTimeout(r, ms));
  }

  /** Cache key per account (hashed: no email in Redis). */
  static keyFor(email: string): string {
    return `eskiz:token:${createHash('sha256').update(email.toLowerCase()).digest('base64url').slice(0, 22)}`;
  }

  async get(key: string, login: EskizLogin): Promise<string> {
    const cached = await this.kv.get(key);
    if (cached) return cached;
    return this.renew(key, login);
  }

  async put(key: string, token: string): Promise<void> {
    await this.kv.setPx(key, token, eskizTokenTtlMs(token, this.now()));
  }

  /** Called after a 401: drops `failedToken` (unless another caller already replaced it). */
  async invalidate(key: string, failedToken: string): Promise<void> {
    if ((await this.kv.get(key)) === failedToken) await this.kv.del(key);
  }

  private renew(key: string, login: EskizLogin): Promise<string> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const p = this.renewShared(key, login).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async renewShared(key: string, login: EskizLogin): Promise<string> {
    const lockKey = `${key}:lock`;
    const locked = await this.kv.setNxPx(lockKey, '1', ESKIZ_TOKEN_POLICY.lockMs);
    if (!locked) {
      // Another process is logging in: use its token when it lands.
      for (let waited = 0; waited < ESKIZ_TOKEN_POLICY.lockMs;) {
        await this.sleep(ESKIZ_TOKEN_POLICY.waitStepMs);
        waited += ESKIZ_TOKEN_POLICY.waitStepMs;
        const t = await this.kv.get(key);
        if (t) return t;
      }
    }
    try {
      const token = await login();
      await this.put(key, token);
      return token;
    } finally {
      if (locked) await this.kv.del(lockKey);
    }
  }
}

// ── HTTP ──

function form(fields: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
}

function parseJson(res: HttpResponse): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(res.text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Provider error text for logs: Eskiz echoes request fields, so phones are masked. */
function errorText(res: HttpResponse): string {
  const body = parseJson(res);
  const msg = body?.message ?? body?.status ?? res.text.slice(0, 120);
  return maskPhonesInText(
    `HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`,
  );
}

export class EskizSmsProvider implements SmsProvider {
  readonly key = 'eskiz' as const;

  constructor(
    private readonly creds: EskizCredentials,
    private readonly deps: {
      http: HttpClient;
      tokens: EskizTokenCache;
      apiUrl: string;
      /** Absolute URL of our callback endpoint (with the secret token), or null to omit. */
      callbackUrl: string | null;
    },
  ) {}

  private url(path: string): string {
    return `${this.deps.apiUrl.replace(/\/+$/, '')}${path}`;
  }

  private get tokenKey(): string {
    return EskizTokenCache.keyFor(this.creds.email);
  }

  /** POST /auth/login → bearer token. Also the health check. */
  async login(): Promise<string> {
    const res = await this.deps.http.request({
      method: 'POST',
      url: this.url('/auth/login'),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ email: this.creds.email, password: this.creds.password }),
      // Login has no side effects: safe to retry on 5xx / network errors.
      idempotent: true,
    });
    const token = (parseJson(res)?.data as { token?: unknown } | undefined)?.token;
    if (res.status !== 200 || typeof token !== 'string' || !token)
      throw new EskizError(`login failed: ${errorText(res)}`, res.status);
    return token;
  }

  async test(): Promise<HealthResult> {
    try {
      // A verified login is a fresh token (e.g. after a password change): it replaces the cached one.
      await this.deps.tokens.put(this.tokenKey, await this.login());
      return { ok: true, message: 'login ok' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async send(input: { phone: string; text: string; templateKey: string }) {
    const body = form({
      mobile_phone: eskizPhone(input.phone),
      message: input.text,
      from: this.creds.from,
      callback_url: this.deps.callbackUrl ?? undefined,
    });
    let token = await this.deps.tokens.get(this.tokenKey, () => this.login());
    let res = await this.post('/message/sms/send', body, token);
    if (res.status === 401) {
      // Expired/revoked token: log in once more, then give up.
      await this.deps.tokens.invalidate(this.tokenKey, token);
      token = await this.deps.tokens.get(this.tokenKey, () => this.login());
      res = await this.post('/message/sms/send', body, token);
    }
    const id = parseJson(res)?.id;
    if (res.status < 200 || res.status >= 300 || (typeof id !== 'string' && typeof id !== 'number'))
      throw new EskizError(`send failed: ${errorText(res)}`, res.status);
    return { providerId: String(id) };
  }

  /** Never retried: a timed-out send may still have gone out (no idempotency key in the API). */
  private post(path: string, body: string, token: string): Promise<HttpResponse> {
    return this.deps.http.request({
      method: 'POST',
      url: this.url(path),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      idempotent: false,
    });
  }
}
