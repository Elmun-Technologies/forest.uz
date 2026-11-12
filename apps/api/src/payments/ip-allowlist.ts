/**
 * Optional source-IP allowlist from a payment integration's settings (`allowedIps`, comma list).
 * Empty = any source; the provider signature/key still authenticates every call. Payme and Click
 * publish their callback IPs to merchants, not in their public repos, so the Owner enters them.
 */
export function ipAllowed(allowlist: string | undefined, ip: string | null): boolean {
  const list = (allowlist ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return true;
  const normalized = ip?.replace(/^::ffff:/, '') ?? '';
  return list.includes(normalized);
}
