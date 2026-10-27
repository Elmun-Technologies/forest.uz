/**
 * PII/secret redaction for logs and IntegrationLog payloads (docs/14). Matches keys
 * case-insensitively, recursively. Phones inside free text are masked too.
 */
const SENSITIVE_KEY =
  /(authorization|password|passwd|secret|token|api[-_]?key|phone|mobile|card|pan|cvv|address|contact_?phone|otp|code_?hash|cookie|set-cookie|credentials|totp|^text$|^body$|^message$|^caption$)/i;

const PHONE_IN_TEXT = /(\+?998)[\s-]?\(?(\d{2})\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?(\d{2})/g;

export const REDACTED = '[redacted]';

/**
 * URL safe for logs: drops the query string and masks path segments that look like credentials
 * (Telegram puts the bot token in the path: /bot<token>/sendMessage).
 */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split('/')
      .map((seg) =>
        /^bot\d+:/.test(seg) ? 'bot***' : seg.length >= 24 && /^[\w:-]+$/.test(seg) ? '***' : seg,
      )
      .join('/');
    return `${u.origin}${path}`;
  } catch {
    return '[invalid-url]';
  }
}

/** Our own routes whose next path segment is a secret (Eskiz callback, MoySklad webhook token). */
const SECRET_SEGMENT_AFTER = /(\/webhooks\/(?:eskiz|moysklad)\/)[^/]+/gi; // Express routes ignore case

/**
 * Request path for access logs: no query string (tracking links, Yandex callback key) and secret
 * path segments masked. Unlike `safeUrl` there is no length heuristic: long product slugs and ids
 * stay readable in access logs.
 */
export function requestLogPath(url: string): string {
  return (url.split('?')[0] ?? '').replace(SECRET_SEGMENT_AFTER, '$1***');
}

/** Pino `serializers.req`: method + masked path only. */
export function serializeRequestForLog(req: { id: string; method: string; url: string }) {
  return { id: req.id, method: req.method, path: requestLogPath(req.url) };
}

export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, '+998 $2 *** ** $3');
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as T;
  if (typeof value === 'string') return maskPhonesInText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Pino `redact.paths` for request logging. */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.phone',
  '*.password',
  '*.token',
  '*.secret',
  '*.address',
];
