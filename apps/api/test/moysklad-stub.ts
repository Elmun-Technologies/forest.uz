import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

/**
 * Local emulation of api.moysklad.ru JSON API 1.2 for integration tests: the subset the adapter
 * uses (docs/runbooks/moysklad.md), with gzip-only responses, Bearer auth, small pages with
 * `meta.nextHref`, the `{errors:[…]}` envelope and fault injection (429 with Lognex headers).
 */
const PREFIX = '/api/remap/1.2/';
const PAGE = 2;

export interface StubRow {
  id: string;
  meta: { href: string; type: string };
  [k: string]: unknown;
}

export interface StubOrder {
  id: string;
  body: Record<string, unknown>;
  stateId: string | null;
  positions: { id: string; quantity: number; reserve: number }[];
}

type Fault = { status: number; headers?: Record<string, string>; body?: unknown };

export class MoyskladStub {
  /** Per-run token (no credential-looking literal in the repo). */
  readonly token = randomBytes(20).toString('hex');
  readonly products: StubRow[] = [];
  readonly variants: StubRow[] = [];
  readonly bundles: StubRow[] = [];
  /** storeId → assortmentId → { stock, reserve } */
  readonly stock = new Map<string, Map<string, { stock: number; reserve: number }>>();
  readonly orders = new Map<string, StubOrder>();
  readonly counterparties: { id: string; phone: string; name: string }[] = [];
  readonly webhooks: Record<string, unknown>[] = [];
  readonly webhookStocks: Record<string, unknown>[] = [];
  readonly states = [
    { id: randomUUID(), name: 'Новый' },
    { id: randomUUID(), name: 'Подтвержден' },
    { id: randomUUID(), name: 'Собран' },
    { id: randomUUID(), name: 'Отгружен' },
    { id: randomUUID(), name: 'Доставлен' },
    { id: randomUUID(), name: 'Возврат' },
    { id: randomUUID(), name: 'Отменен' },
  ];
  readonly organizationId = randomUUID();
  /** `entity/currency`; tests may switch the default to another currency. */
  readonly currencies: { id: string; isoCode: string; code: string; default: boolean }[] = [
    { id: randomUUID(), isoCode: 'UZS', code: '860', default: true },
    { id: randomUUID(), isoCode: 'RUB', code: '643', default: false },
  ];
  readonly deliveryAttributeId = randomUUID();
  readonly calls: {
    method: string;
    path: string;
    query: URLSearchParams;
    body: unknown;
    auth?: string;
  }[] = [];
  private readonly faults = new Map<string, Fault[]>();
  private server: Server | undefined;

  get url(): string {
    const a = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${a.port}/api/remap/1.2`;
  }

  href(type: string, id: string): string {
    return `${this.url}/entity/${type}/${id}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  /** Next requests to `METHOD path` (e.g. `GET entity/organization`) get these answers. */
  fail(key: string, ...faults: Fault[]): void {
    this.faults.set(key, [...(this.faults.get(key) ?? []), ...faults]);
  }

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }

  setStock(storeId: string, assortmentId: string, stock: number, reserve = 0): void {
    const m = this.stock.get(storeId) ?? new Map();
    m.set(assortmentId, { stock, reserve });
    this.stock.set(storeId, m);
  }

  stateName(id: string | null): string | null {
    return this.states.find((s) => s.id === id)?.name ?? null;
  }

  private send(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const raw = Buffer.from(JSON.stringify(body ?? {}));
    res.writeHead(status, {
      'Content-Type': 'application/json;charset=utf-8',
      'Content-Encoding': 'gzip',
      'X-RateLimit-Limit': '45',
      'X-RateLimit-Remaining': '40',
      'X-Lognex-Retry-TimeInterval': '3000',
      ...headers,
    });
    res.end(gzipSync(raw));
  }

  private error(res: ServerResponse, status: number, code: number, message: string) {
    this.send(res, status, { errors: [{ error: message, code, error_message: message }] });
  }

  private list(res: ServerResponse, path: string, rows: unknown[], q: URLSearchParams) {
    const offset = Number(q.get('offset') ?? '0');
    const limit = Math.min(Number(q.get('limit') ?? '1000'), PAGE);
    const page = rows.slice(offset, offset + limit);
    const next = offset + limit < rows.length;
    const nq = new URLSearchParams(q);
    nq.set('offset', String(offset + limit));
    nq.set('limit', String(limit));
    this.send(res, 200, {
      meta: {
        href: `${this.url}/${path}`,
        size: rows.length,
        limit,
        offset,
        ...(next ? { nextHref: `${this.url}/${path}?${nq.toString()}` } : {}),
      },
      rows: page,
    });
  }

  private filter(q: URLSearchParams): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (q.get('filter') ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
    }
    return out;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://stub');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body: unknown = text ? JSON.parse(text) : undefined;
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const method = req.method ?? 'GET';
    this.calls.push({
      method,
      path,
      query: url.searchParams,
      body,
      auth: req.headers.authorization,
    });

    if (req.headers.authorization !== `Bearer ${this.token}`)
      return this.error(res, 401, 1056, 'Ошибка аутентификации');
    if (!String(req.headers['accept-encoding'] ?? '').includes('gzip'))
      return this.error(res, 415, 1062, 'gzip required');
    const fault = this.faults.get(`${method} ${path}`)?.shift();
    if (fault) return this.send(res, fault.status, fault.body ?? {}, fault.headers);
    this.route(method, path, url.searchParams, body, res);
  }

  private route(
    method: string,
    path: string,
    q: URLSearchParams,
    body: unknown,
    res: ServerResponse,
  ): void {
    const b = (body ?? {}) as Record<string, unknown>;
    const seg = path.split('/');
    const f = this.filter(q);
    if (method === 'GET' && path === 'entity/organization')
      return this.list(
        res,
        path,
        [
          {
            id: this.organizationId,
            meta: { href: this.href('organization', this.organizationId), type: 'organization' },
          },
        ],
        q,
      );
    if (method === 'GET' && path === 'context/companysettings/pricetype')
      return this.send(res, 200, [
        { id: randomUUID(), name: 'Chakana' },
        { id: randomUUID(), name: 'Ulgurji' },
      ]);
    if (method === 'GET' && path === 'entity/currency')
      return this.list(res, path, this.currencies, q);
    if (method === 'GET' && path === 'entity/product')
      return this.list(res, path, this.products, q);
    if (method === 'GET' && path === 'entity/variant') {
      const rows = f.productid
        ? this.variants.filter((v) =>
            (v.product as { meta: { href: string } }).meta.href.endsWith(f.productid!),
          )
        : this.variants;
      return this.list(res, path, rows, q);
    }
    if (method === 'GET' && path === 'entity/bundle') return this.list(res, path, this.bundles, q);
    if (
      method === 'GET' &&
      seg[0] === 'entity' &&
      ['product', 'variant', 'bundle'].includes(seg[1]!) &&
      seg.length === 3
    ) {
      const pool =
        seg[1] === 'product' ? this.products : seg[1] === 'variant' ? this.variants : this.bundles;
      const row = pool.find((r) => r.id === seg[2]);
      return row ? this.send(res, 200, row) : this.error(res, 404, 1021, 'Объект не найден');
    }
    if (
      method === 'GET' &&
      (path === 'report/stock/bystore/current' || path === 'report/stock/all/current')
    ) {
      if (q.get('stockType') !== 'freeStock') return this.error(res, 400, 3000, 'stockType');
      const rows: Record<string, unknown>[] = [];
      for (const [storeId, m] of this.stock)
        for (const [assortmentId, s] of m)
          rows.push({
            assortmentId,
            ...(path.includes('bystore') ? { storeId } : {}),
            freeStock: s.stock - s.reserve,
          });
      return this.send(res, 200, rows);
    }
    if (method === 'GET' && path === 'entity/customerorder') {
      const rows = [...this.orders.values()]
        .filter((o) => !f.name || o.body.name === f.name)
        .map((o) => ({ id: o.id, name: o.body.name }));
      return this.list(res, path, rows, q);
    }
    if (method === 'GET' && path === 'entity/counterparty') {
      const rows = this.counterparties.filter((c) => !f.phone || c.phone === f.phone);
      return this.list(res, path, rows, q);
    }
    if (method === 'POST' && path === 'entity/counterparty') {
      const c = { id: randomUUID(), phone: String(b.phone), name: String(b.name) };
      this.counterparties.push(c);
      return this.send(res, 200, c);
    }
    if (method === 'GET' && path === 'entity/customerorder/metadata')
      return this.send(res, 200, {
        states: this.states.map((s) => ({
          ...s,
          meta: { href: this.href('customerorder/metadata/states', s.id) },
        })),
      });
    if (method === 'GET' && path === 'entity/customerorder/metadata/attributes')
      return this.send(res, 200, {
        rows: [{ id: this.deliveryAttributeId, name: 'dostavka', type: 'string' }],
      });
    if (method === 'POST' && path === 'entity/customerorder') {
      const id = randomUUID();
      const positions = ((b.positions ?? []) as { quantity: number; reserve?: number }[]).map(
        (p) => ({
          id: randomUUID(),
          quantity: p.quantity,
          reserve: p.reserve ?? 0,
        }),
      );
      const stateHref = (b.state as { meta?: { href?: string } } | undefined)?.meta?.href ?? null;
      this.orders.set(id, {
        id,
        body: b,
        stateId: stateHref?.split('/').at(-1) ?? null,
        positions,
      });
      return this.send(res, 200, { id, name: b.name });
    }
    if (seg[0] === 'entity' && seg[1] === 'customerorder' && seg[2]) {
      const o = this.orders.get(seg[2]);
      if (!o) return this.error(res, 404, 1021, 'Объект не найден');
      if (method === 'PUT' && seg.length === 3) {
        const href = (b.state as { meta?: { href?: string } } | undefined)?.meta?.href;
        if (href) o.stateId = href.split('/').at(-1) ?? null;
        return this.send(res, 200, { id: o.id });
      }
      if (method === 'GET' && seg[3] === 'positions' && seg.length === 4)
        return this.list(res, path, o.positions, q);
      if (method === 'PUT' && seg[3] === 'positions' && seg[4]) {
        const p = o.positions.find((x) => x.id === seg[4]);
        if (!p) return this.error(res, 404, 1021, 'Объект не найден');
        if (typeof b.reserve === 'number') p.reserve = b.reserve;
        return this.send(res, 200, p);
      }
    }
    if (path === 'entity/webhook' || path === 'entity/webhookstock') {
      const store = path === 'entity/webhook' ? this.webhooks : this.webhookStocks;
      if (method === 'GET') return this.list(res, path, store, q);
      if (method === 'POST') {
        const row = { id: randomUUID(), ...b };
        store.push(row);
        return this.send(res, 200, row);
      }
    }
    this.error(res, 404, 1002, `Неопознанный путь: ${path}`);
  }
}
