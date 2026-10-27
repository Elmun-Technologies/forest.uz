import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local emulation of b2b.taxi.yandex.net (Express Claims API v2) for integration tests: the
 * subset of methods the adapter uses, with the request shapes from docs/runbooks/delivery.md
 * (claim_id / request_id in the query, version in the body) and fault injection.
 */
export interface StubClaim {
  id: string;
  requestId: string;
  status: string;
  version: number;
  updatedTs: string;
  body: Record<string, unknown>;
  cancelState: 'free' | 'paid' | 'unavailable';
  performer: Record<string, unknown> | null;
}

type Fault = 'reset-after' | 'reset' | { status: number; body?: unknown };

export class YandexStub {
  readonly token = 'y0_stub-oauth-token';
  readonly claims = new Map<string, StubClaim>();
  readonly calls: {
    method: string;
    path: string;
    query: URLSearchParams;
    body: unknown;
    auth: string | undefined;
  }[] = [];
  /** Faults by method path (e.g. 'claims/info' or 'claims/info#<claimId>'), one per request. */
  readonly faults = new Map<string, Fault[]>();
  price = '27500.00';
  currency = 'UZS';
  private server: Server | undefined;
  private seq = 0;
  private clock = Date.now();

  get url(): string {
    const a = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${a.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  count(path: string): number {
    return this.calls.filter((c) => c.path === path).length;
  }

  fail(path: string, ...faults: Fault[]): void {
    this.faults.set(path, [...(this.faults.get(path) ?? []), ...faults]);
  }

  /** Moves a claim forward like Yandex would (new updated_ts each time). */
  advance(id: string, status: string, performer?: Record<string, unknown>): void {
    const c = this.claims.get(id);
    if (!c) throw new Error(`no claim ${id}`);
    c.status = status;
    if (performer) c.performer = performer;
    c.updatedTs = this.tick();
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private info(c: StubClaim) {
    return {
      id: c.id,
      status: c.status,
      version: c.version,
      updated_ts: c.updatedTs,
      pricing: { currency: 'UZS', offer: { price: this.price } },
      ...(c.performer ? { performer_info: c.performer } : {}),
      route_points: c.body.route_points,
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://stub');
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks).toString();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const path = url.pathname.replace('/b2b/cargo/integration/v2/', '');
    this.calls.push({
      method: req.method ?? '',
      path,
      query: url.searchParams,
      body,
      auth: req.headers.authorization,
    });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${this.token}`)
      return send(401, { code: 'unauthorized', message: 'Not authorized' });

    // Faults for one claim (`claims/info#<id>`) win over faults for the whole method.
    const claimKey = `${path}#${url.searchParams.get('claim_id') ?? ''}`;
    const fault = (
      this.faults.get(claimKey)?.length ? this.faults.get(claimKey) : this.faults.get(path)
    )?.shift();
    if (fault === 'reset') return void req.socket.destroy();
    if (fault && typeof fault === 'object')
      return send(fault.status, fault.body ?? { code: 'error', message: 'stub' });

    const claimId = url.searchParams.get('claim_id') ?? '';
    const claim = this.claims.get(claimId);
    const b = (body ?? {}) as Record<string, unknown>;
    let out: { status: number; payload: unknown };
    switch (path) {
      case 'claims/search':
        out = { status: 200, payload: { claims: [] } };
        break;
      case 'check-price':
        out = {
          status: 200,
          payload: {
            price: this.price,
            currency_rules: { code: this.currency, sign: "so'm" },
            eta: 22,
            distance_meters: 6100,
          },
        };
        break;
      case 'claims/create': {
        const requestId = url.searchParams.get('request_id');
        if (!requestId) {
          out = { status: 400, payload: { code: 'bad_request', message: 'request_id required' } };
          break;
        }
        // Idempotency token: the same request_id returns the claim created first.
        let c = [...this.claims.values()].find((x) => x.requestId === requestId);
        if (!c) {
          c = {
            id: `stub-claim-${++this.seq}`,
            requestId,
            status: 'ready_for_approval',
            version: 1,
            updatedTs: this.tick(),
            body: b,
            cancelState: 'free',
            performer: null,
          };
          this.claims.set(c.id, c);
        }
        out = { status: 200, payload: this.info(c) };
        break;
      }
      case 'claims/info':
        out = claim
          ? { status: 200, payload: this.info(claim) }
          : { status: 404, payload: { code: 'not_found', message: 'claim' } };
        break;
      case 'claims/accept':
        if (!claim) out = { status: 404, payload: { code: 'not_found', message: 'claim' } };
        else if (b.version !== claim.version)
          out = { status: 409, payload: { code: 'old_version', message: 'version' } };
        else if (claim.status !== 'ready_for_approval')
          out = { status: 409, payload: { code: 'inappropriate_status', message: claim.status } };
        else {
          claim.status = 'accepted';
          claim.updatedTs = this.tick();
          out = {
            status: 200,
            payload: { id: claim.id, status: claim.status, version: claim.version },
          };
        }
        break;
      case 'claims/cancel-info':
        out = claim
          ? { status: 200, payload: { cancel_state: claim.cancelState, price: '5000.00' } }
          : { status: 404, payload: { code: 'not_found' } };
        break;
      case 'claims/cancel':
        if (!claim) out = { status: 404, payload: { code: 'not_found' } };
        else if (b.cancel_state !== claim.cancelState || claim.cancelState === 'unavailable')
          out = { status: 409, payload: { code: 'inappropriate_status', message: 'cancel' } };
        else {
          claim.status = b.cancel_state === 'paid' ? 'cancelled_with_payment' : 'cancelled';
          claim.updatedTs = this.tick();
          out = {
            status: 200,
            payload: { id: claim.id, status: claim.status, version: claim.version },
          };
        }
        break;
      case 'claims/points-eta':
        out = {
          status: 200,
          payload: {
            route_points: [
              { id: 1, type: 'source', visit_status: 'visited', visited_at: {} },
              {
                id: 2,
                type: 'destination',
                visit_status: 'pending',
                visited_at: { expected: '2026-10-27T09:40:00Z' },
              },
            ],
          },
        };
        break;
      case 'driver-voiceforwarding':
        out = { status: 200, payload: { phone: '+79099999998', ext: '0163', ttl_seconds: 900 } };
        break;
      default:
        out = { status: 404, payload: { code: 'not_found', message: path } };
    }
    if (fault === 'reset-after') return void req.socket.destroy();
    send(out.status, out.payload);
  }
}
