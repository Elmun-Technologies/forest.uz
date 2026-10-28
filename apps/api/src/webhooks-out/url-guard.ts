import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { DomainError } from '@forest/contracts';

/**
 * SSRF guard for admin-entered webhook URLs (CLAUDE.md §6). Strict mode (production): https on
 * ports 443/8443 only, to hosts that resolve to public addresses. The check runs when the URL is
 * saved and again inside the connection itself (`pinnedLookup`), so a DNS answer that changes
 * between the check and the request (rebinding) can't reach a private address.
 * Non-strict (dev/test): http, any port and local receivers.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  // Unspecified, loopback and IPv4-compatible (::a.b.c.d) addresses.
  ['::', 96],
  ['::1', 128],
  // Discard-only, NAT64 (well-known + local-use), 6to4 (embeds any IPv4, private included).
  ['100::', 64],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** Ports a strict-mode webhook may use (default https port included). */
export const WEBHOOK_PORTS = ['', '443', '8443'] as const;

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    return mapped ? blocked.check(mapped, 'ipv4') : blocked.check(ip, 'ipv6');
  }
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;

export const dnsResolver: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

const invalid = () => new DomainError('WEBHOOK_URL_INVALID', undefined, 'url');

/** All addresses of `host` (IP literal or name); strict mode refuses any private one. */
export async function vettedAddresses(
  host: string,
  opts: { strict: boolean; resolve?: Resolver },
): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (opts.resolve ?? dnsResolver)(host);
  } catch {
    throw invalid();
  }
  if (addresses.length === 0) throw invalid();
  if (opts.strict && addresses.some(isPrivateAddress)) throw invalid();
  return addresses;
}

/** Throws WEBHOOK_URL_INVALID unless `raw` may receive our webhooks. Returns the normalised URL. */
export async function assertWebhookUrl(
  raw: string,
  opts: { strict: boolean; resolve?: Resolver },
): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if (url.username || url.password) throw invalid();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !opts.strict)) throw invalid();
  if (!opts.strict) return url.toString();
  if (!(WEBHOOK_PORTS as readonly string[]).includes(url.port)) throw invalid();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw invalid();
  await vettedAddresses(host, opts);
  return url.toString();
}

/**
 * `lookup` for the outgoing socket: resolves once, applies the same checks and hands the socket
 * only the vetted address — the connection can't use a different DNS answer than the one checked.
 * TLS SNI and the Host header still carry the URL's host name.
 */
export function pinnedLookup(opts: { strict: boolean; resolve?: Resolver }): LookupFunction {
  return (hostname, options, callback) => {
    vettedAddresses(hostname, opts).then(
      (addresses) => {
        const family = (a: string) => (isIP(a) === 6 ? 6 : 4);
        if (options.all)
          callback(
            null,
            addresses.map((address) => ({ address, family: family(address) })),
          );
        else callback(null, addresses[0]!, family(addresses[0]!));
      },
      (e: unknown) => callback(e as NodeJS.ErrnoException, '', 4),
    );
  };
}
