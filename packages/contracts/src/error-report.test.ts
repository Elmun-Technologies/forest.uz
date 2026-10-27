import { describe, expect, it, vi } from 'vitest';
import {
  buildEnvelope,
  createErrorReporter,
  parseDsn,
  parseStack,
  safeMessage,
  scrubText,
} from './error-report';

const DSN = 'https://abc123@glitchtip.example.uz/7';

describe('parseDsn', () => {
  it('derives the envelope endpoint and key', () => {
    expect(parseDsn(DSN)).toEqual({
      envelopeUrl: 'https://glitchtip.example.uz/api/7/envelope/',
      publicKey: 'abc123',
      dsn: DSN,
    });
    expect(parseDsn('https://k@host:8443/prefix/12')?.envelopeUrl).toBe(
      'https://host:8443/prefix/api/12/envelope/',
    );
  });
  it('rejects malformed DSNs', () => {
    for (const bad of ['', 'nope', 'https://host/7', 'https://k@host/abc', 'ftp://k@h/1'])
      expect(parseDsn(bad)).toBeNull();
  });
});

describe('scrubbing', () => {
  it('masks phones, emails, bearer tokens and long ids', () => {
    const s = scrubText(
      'user +998 90 123 45 67 / ali@mail.uz sent Bearer eyJhbGciOi.abc session k3j4h5k6j7h8k9l0m1n2b3v4c5',
    );
    expect(s).not.toMatch(/123 45 67|ali@mail|eyJhbGciOi|k3j4h5k6j7h8k9l0m1n2b3v4c5/);
    expect(s).toContain('[phone]');
    expect(s).toContain('[email]');
  });
  it('keeps only the first line of Prisma errors (they echo arguments)', () => {
    const e = Object.assign(
      new Error(
        'Invalid `prisma.customer.update()` invocation:\n{ data: { name: "Aziza Karimova", address: "Chilonzor 5" } }',
      ),
      { name: 'PrismaClientKnownRequestError', code: 'P2002' },
    );
    const m = safeMessage(e);
    expect(m.type).toBe('PrismaClientKnownRequestError');
    expect(m.value).toBe('Invalid `prisma.customer.update()` invocation: [P2002]');
  });
  it('handles non-errors', () => {
    expect(safeMessage('boom +998901234567').value).toBe('boom [phone]');
  });
});

describe('parseStack', () => {
  it('parses V8 frames oldest first and flags library code', () => {
    const frames = parseStack(
      [
        'Error: x',
        '    at OrdersService.place (/app/dist/commerce/checkout.service.js:10:5)',
        '    at /app/node_modules/@nestjs/core/router.js:3:9',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n'),
    );
    expect(frames).toHaveLength(3);
    expect(frames[2]).toMatchObject({
      function: 'OrdersService.place',
      filename: '/app/dist/commerce/checkout.service.js',
      lineno: 10,
      in_app: true,
    });
    expect(frames[1]!.in_app).toBe(false);
    expect(frames[0]!.in_app).toBe(false);
  });
});

describe('buildEnvelope', () => {
  it('contains no request data, user or host, only whitelisted context', () => {
    const { id, body } = buildEnvelope(
      new Error('payment failed for +998901234567'),
      { route: '/v1/orders/:publicId', method: 'post', status: 500, requestId: 'req-1' },
      { dsn: DSN, service: 'api', release: 'abc', environment: 'production' },
      1_700_000_000_000,
    );
    const [header, item, eventLine] = body.trim().split('\n');
    expect(JSON.parse(header!)).toMatchObject({ event_id: id, dsn: DSN });
    expect(JSON.parse(item!)).toEqual({ type: 'event' });
    const event = JSON.parse(eventLine!) as Record<string, unknown>;
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('server_name');
    expect(event.tags).toEqual({
      service: 'api',
      route: '/v1/orders/:publicId',
      method: 'POST',
      status: '500',
    });
    expect(event.transaction).toBe('POST /v1/orders/:publicId');
    expect(body).not.toContain('901234567');
  });
});

describe('createErrorReporter', () => {
  it('is a no-op without a DSN', () => {
    const r = createErrorReporter({ dsn: '', service: 'api' });
    expect(r.enabled).toBe(false);
    expect(r.capture(new Error('x'))).toBeNull();
  });
  it('posts envelopes with the auth header and caps the rate', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    let t = 0;
    const r = createErrorReporter({
      dsn: DSN,
      service: 'api',
      maxPerMinute: 2,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => t,
    });
    expect(r.capture(new Error('a'))).toMatch(/^[0-9a-f]{32}$/);
    r.capture(new Error('b'));
    expect(r.capture(new Error('c'))).toBeNull();
    t = 60_000;
    expect(r.capture(new Error('d'))).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://glitchtip.example.uz/api/7/envelope/');
    expect((init.headers as Record<string, string>)['x-sentry-auth']).toContain(
      'sentry_key=abc123',
    );
  });
  it('never throws when sending fails', async () => {
    const onSendError = vi.fn();
    const r = createErrorReporter({
      dsn: DSN,
      service: 'web',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof globalThis.fetch,
      onSendError,
    });
    expect(() => r.capture(new Error('x'))).not.toThrow();
    await new Promise((res) => setTimeout(res, 0));
    expect(onSendError).toHaveBeenCalled();
  });
});
