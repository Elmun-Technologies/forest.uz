// Shared helpers for the Forest k6 scripts (CLAUDE.md §6 "Load test"; README.md).
import { sleep } from 'k6';

/** Storefront origin (through Caddy in staging: https://staging.forest.uz). */
export const SITE = (__ENV.SITE || 'http://web:3000').replace(/\/$/, '');
/** API root incl. /v1. Checkout needs a direct, in-network address (README "client IPs"). */
export const API = (__ENV.API || 'http://api:4000/v1').replace(/\/$/, '');
/** Think-time multiplier: 0 = none (smoke), 1 = realistic, 0.5 = users twice as fast. */
export const THINK = Number(__ENV.THINK_SCALE ?? 1);
export const LOCALES = ['uz', 'ru'];

/** `HOSTS="shop.localhost=172.20.0.5,admin.localhost=…"` → k6 `hosts` option (TLS SNI kept). */
export function hostsOption() {
  const out = {};
  for (const pair of (__ENV.HOSTS || '').split(',').filter(Boolean)) {
    const [h, ip] = pair.split('=');
    out[h] = ip;
  }
  return out;
}

export function think(minS, maxS) {
  if (THINK > 0) sleep((minS + Math.random() * (maxS - minS)) * THINK);
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * A random client IP for X-Forwarded-For. Only effective when the request reaches the API without
 * Caddy (Caddy replaces untrusted XFF) and TRUST_PROXY_HOPS=1 — i.e. staging, in-network.
 * 100.64.0.0/10 (CGNAT) so it never looks like a real customer address.
 */
export function fakeClientIp() {
  const r = () => Math.floor(Math.random() * 256);
  return `100.${64 + Math.floor(Math.random() * 64)}.${r()}.${r()}`;
}

/** A syntactically valid, unused-looking Uzbek mobile number (E.164). */
export function fakePhone() {
  const op = pick(['90', '91', '93', '94', '97', '99']);
  let rest = '';
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return `+998${op}${rest}`;
}

/** Idempotency-Key format the API accepts (`^[\w-]{16,80}$`). */
export function idempotencyKey() {
  let s = 'k6-';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function devHeaders() {
  return __ENV.DEV_TOKEN ? { 'X-Dev-Token': __ENV.DEV_TOKEN } : {};
}
