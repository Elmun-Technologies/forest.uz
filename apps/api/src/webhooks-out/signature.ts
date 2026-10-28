import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_POLICY } from '@forest/contracts';

/**
 * Outbound webhook signature (docs/05, CLAUDE.md §6) — same scheme as the storefront revalidation
 * route: `X-Forest-Signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Receivers verify with `verifyWebhookSignature` (or its equivalent, docs/runbooks/webhooks-and-api.md).
 */
export const SIGNATURE_HEADER = 'X-Forest-Signature';
export const EVENT_HEADER = 'X-Forest-Event';
export const DELIVERY_HEADER = 'X-Forest-Delivery';

const SECRET_PREFIX = 'whsec_';

/** 32 random bytes; the prefix makes leaked secrets recognisable to scanners. */
export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function maskWebhookSecret(last4: string): string {
  return `${SECRET_PREFIX}••••${last4}`;
}

export function signWebhook(
  secret: string,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac('sha256', secret).update(`${nowS}.${body}`).digest('hex');
  return `t=${nowS},v1=${mac}`;
}

/**
 * Receiver-side check: well-formed header, timestamp within `toleranceSec` (replay window) and a
 * matching HMAC, compared in constant time. Several `v1=` values are accepted (secret rotation).
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
  toleranceSec: number = WEBHOOK_POLICY.toleranceSec,
): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim());
  const t = /^t=(\d{1,12})$/.exec(parts[0] ?? '')?.[1];
  if (!t) return false;
  const ts = Number(t);
  if (Math.abs(nowS - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest();
  return parts.slice(1).some((p) => {
    const hex = /^v1=([0-9a-f]{64})$/.exec(p)?.[1];
    return !!hex && timingSafeEqual(expected, Buffer.from(hex, 'hex'));
  });
}
