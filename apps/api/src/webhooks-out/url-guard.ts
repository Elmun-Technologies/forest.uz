import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { DomainError } from '@forest/contracts';

/**
 * SSRF guard for admin-entered webhook URLs (CLAUDE.md §6). In production only https to hosts
 * that resolve to public addresses; elsewhere (dev/test) http and local receivers are allowed.
 * Checked when the URL is saved and again right before each send (DNS may change).
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
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

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

const dnsResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Throws WEBHOOK_URL_INVALID unless `raw` may receive our webhooks. Returns the normalised URL. */
export async function assertWebhookUrl(
  raw: string,
  opts: { strict: boolean; resolve?: Resolver },
): Promise<string> {
  const fail = () => new DomainError('WEBHOOK_URL_INVALID', undefined, 'url');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw fail();
  }
  if (url.username || url.password) throw fail();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !opts.strict)) throw fail();
  if (!opts.strict) return url.toString();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw fail();
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (opts.resolve ?? dnsResolver)(host);
  } catch {
    throw fail();
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw fail();
  return url.toString();
}
