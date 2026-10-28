import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postPinned } from './http-post';

describe('postPinned (DNS-rebinding safe POST)', () => {
  let server: Server;
  let port = 0;
  const got: { host?: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        got.push({ host: req.headers.host, body });
        res.statusCode = req.url === '/slow' ? 200 : 204;
        if (req.url === '/slow') setTimeout(() => res.end(), 2_000);
        else res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('connects to the address the resolver vetted, keeping the Host header', async () => {
    const resolve = async () => ['127.0.0.1'];
    const status = await postPinned(`http://hooks.example.test:${port}/x`, {}, '{"a":1}', {
      strict: false,
      timeoutMs: 1_000,
      resolve,
    });
    expect(status).toBe(204);
    expect(got.at(-1)).toEqual({ host: `hooks.example.test:${port}`, body: '{"a":1}' });
  });

  it('strict: a name that resolves to a private address never gets a connection', async () => {
    let calls = 0;
    // Rebinding: public on the first answer, private on the next — every answer is checked.
    const resolve = async () => (calls++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']);
    await expect(
      postPinned(`http://rebind.example.test:${port}/x`, {}, '{}', {
        strict: true,
        timeoutMs: 1_000,
        resolve: async () => {
          await resolve();
          return resolve();
        },
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_URL_INVALID' });
    expect(got.every((g) => g.host !== `rebind.example.test:${port}`)).toBe(true);
  });

  it('enforces the wall-clock timeout', async () => {
    await expect(
      postPinned(`http://127.0.0.1:${port}/slow`, {}, '{}', { strict: false, timeoutMs: 200 }),
    ).rejects.toThrow('timeout');
  });
});
