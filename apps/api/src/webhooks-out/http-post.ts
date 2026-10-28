import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pinnedLookup, type Resolver } from './url-guard';

/**
 * One webhook POST over node:http(s) with the vetted-address `lookup` (DNS-rebinding safe), a hard
 * timeout and no redirect following. Resolves with the status code; the body is discarded.
 */
export function postPinned(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: { strict: boolean; timeoutMs: number; resolve?: Resolver },
): Promise<number> {
  const u = new URL(url);
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      u,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: pinnedLookup(opts),
        timeout: opts.timeoutMs,
      },
      (res) => {
        res.resume();
        res.on('error', () => undefined);
        resolve(res.statusCode ?? 0);
      },
    );
    // Wall-clock limit (socket `timeout` is only inactivity).
    const timer = setTimeout(() => req.destroy(new Error('timeout')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}
