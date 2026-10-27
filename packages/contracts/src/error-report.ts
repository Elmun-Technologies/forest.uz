/**
 * Minimal Sentry-protocol error reporting for the self-hosted GlitchTip (CLAUDE.md §6 "Error
 * monitoring"). One implementation for api (exception filter, unhandled rejections) and the
 * web/admin servers (`instrumentation.ts` `onRequestError`); no SDK, nothing in client bundles
 * (main entry only, not `/core`).
 *
 * Privacy (docs/14, UZ personal data): an event carries the error type, a scrubbed message,
 * stack frames, the route *template*, method, status, request id, service, release and
 * environment. Never request bodies, headers, cookies, query strings, concrete paths, user ids or
 * IP addresses.
 */

export interface ErrorReportContext {
  /** Route template (`/v1/orders/:publicId`, `/[locale]/p/[slug]`) — never the concrete path. */
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  /** Extra low-cardinality tags (job name, queue…). Values are scrubbed too. */
  tags?: Record<string, string>;
}

export interface ErrorReporterOptions {
  dsn: string;
  service: string;
  release?: string;
  environment?: string;
  /** Upper bound of events sent per minute and process (an error storm must not DoS GlitchTip). */
  maxPerMinute?: number;
  fetch?: typeof fetch;
  now?: () => number;
  onSendError?: (e: unknown) => void;
}

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** `https://<key>@host[:port][/prefix]/<projectId>` → envelope endpoint + key; null if invalid. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const key = decodeURIComponent(u.username);
    const parts = u.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!key || !project || !/^\d+$/.test(project)) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return {
      envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`,
      publicKey: key,
      dsn,
    };
  } catch {
    return null;
  }
}

const PHONE = /(\+?998)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Long opaque strings (tokens, session ids, keys) — but keep file paths and plain words. */
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g;
const BEARER = /(bearer|basic)\s+[^\s"']+/gi;

/** Masks personal data and secrets in free text (error messages, tag values). */
export function scrubText(text: string, max = 1000): string {
  const out = text
    .replace(BEARER, '$1 [redacted]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
    .replace(TOKEN, '[token]');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * Message safe to send. Prisma (and similar) errors echo query arguments — phones, names,
 * addresses — after their first line, so only the first line and the error code are kept.
 */
export function safeMessage(err: unknown): { type: string; value: string } {
  if (!(err instanceof Error)) return { type: 'NonError', value: scrubText(String(err), 200) };
  const type = err.name || err.constructor?.name || 'Error';
  const code = (err as { code?: unknown }).code;
  let value = err.message ?? '';
  if (/^Prisma/.test(type) || /prisma\./.test(value)) {
    value = value.split('\n').find((l) => l.trim()) ?? '';
  }
  value = scrubText(value.trim());
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/i.test(code)) value = `${value} [${code}]`;
  return { type, value };
}

export interface StackFrame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** V8 stack → Sentry frames (oldest first, as the protocol expects). */
export function parseStack(stack: string | undefined, limit = 40): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, '');
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal|^internal\//.test(filename),
    });
    if (frames.length >= limit) break;
  }
  return frames.reverse();
}

function eventId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds the Sentry envelope body (3 lines: envelope header, item header, event). */
export function buildEnvelope(
  err: unknown,
  ctx: ErrorReportContext,
  opts: Pick<ErrorReporterOptions, 'service' | 'release' | 'environment'> & { dsn: string },
  nowMs = Date.now(),
): { id: string; body: string } {
  const id = eventId();
  const { type, value } = safeMessage(err);
  const tags: Record<string, string> = { service: opts.service };
  if (ctx.route) tags.route = scrubText(ctx.route, 200);
  if (ctx.method) tags.method = ctx.method.toUpperCase().slice(0, 10);
  if (ctx.status) tags.status = String(ctx.status);
  for (const [k, v] of Object.entries(ctx.tags ?? {})) tags[k.slice(0, 32)] = scrubText(v, 200);
  const event = {
    event_id: id,
    timestamp: nowMs / 1000,
    platform: 'node',
    level: 'error',
    logger: opts.service,
    ...(opts.release ? { release: opts.release } : {}),
    environment: opts.environment ?? 'production',
    ...(ctx.route ? { transaction: `${tags.method ?? ''} ${tags.route}`.trim() } : {}),
    tags,
    exception: {
      values: [
        {
          type,
          value,
          stacktrace: { frames: parseStack(err instanceof Error ? err.stack : undefined) },
        },
      ],
    },
    ...(ctx.requestId ? { extra: { requestId: ctx.requestId.slice(0, 64) } } : {}),
    // No `user`, `request` or `server_name`: nothing that identifies a person or a host.
  };
  const header = { event_id: id, sent_at: new Date(nowMs).toISOString(), dsn: opts.dsn };
  return {
    id,
    body: `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`,
  };
}

export interface ErrorReporter {
  /** Fire-and-forget; never throws. Returns the event id, or null when dropped/disabled. */
  capture(err: unknown, ctx?: ErrorReportContext): string | null;
  readonly enabled: boolean;
}

const DISABLED: ErrorReporter = { capture: () => null, enabled: false };

/** Reporter for a DSN; an empty/invalid DSN gives a no-op reporter (monitoring off). */
export function createErrorReporter(opts: ErrorReporterOptions): ErrorReporter {
  const parsed = opts.dsn ? parseDsn(opts.dsn) : null;
  if (!parsed) return DISABLED;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const max = opts.maxPerMinute ?? 30;
  let windowStart = 0;
  let sent = 0;
  return {
    enabled: true,
    capture(err, ctx = {}) {
      try {
        const t = now();
        if (t - windowStart >= 60_000) {
          windowStart = t;
          sent = 0;
        }
        if (sent >= max) return null;
        sent++;
        const { id, body } = buildEnvelope(err, ctx, { ...opts, dsn: parsed.dsn }, t);
        void doFetch(parsed.envelopeUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=forest-reporter/1.0`,
          },
          body,
          signal: AbortSignal.timeout(5000),
        })
          .then((r) => {
            if (!r.ok) opts.onSendError?.(new Error(`error report rejected: HTTP ${r.status}`));
          })
          .catch((e: unknown) => opts.onSendError?.(e));
        return id;
      } catch (e) {
        opts.onSendError?.(e);
        return null;
      }
    },
  };
}
