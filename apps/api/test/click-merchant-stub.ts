import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local emulation of Click's Merchant API fiscalization endpoints (docs.click.uz → Merchant API →
 * Data Fiscalization): `POST /payment/ofd_data/submit_items` and
 * `GET /payment/ofd_data/:service_id/:payment_id`, with the `Auth` header check and fault
 * injection.
 */
export class ClickMerchantStub {
  readonly calls: { method: string; path: string; auth: string | undefined; body: unknown }[] = [];
  /** Receipt links by payment id, set once a submission was accepted. */
  readonly receipts = new Map<string, string>();
  /** Answers for the next submissions (one per call), e.g. `{ error_code: -5, error_note: … }`. */
  readonly submitFaults: Record<string, unknown>[] = [];
  /** Delay the receipt link: number of GETs answered without `qrCodeURL` after a submission. */
  linkDelay = 0;
  private server: Server | undefined;

  constructor(
    readonly merchantUserId: string,
    private readonly secretKey: string,
  ) {}

  get url(): string {
    const a = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${a.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r());
  }

  private authOk(header: string | undefined): boolean {
    const [user, digest, ts] = (header ?? '').split(':');
    if (user !== this.merchantUserId || !ts) return false;
    return (
      digest ===
      createHash('sha1')
        .update(ts + this.secretKey)
        .digest('hex')
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const auth = req.headers.auth as string | undefined;
    let body: unknown = null;
    try {
      body = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      body = raw;
    }
    this.calls.push({ method: req.method ?? '', path, auth, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!this.authOk(auth)) return send(401, { error_code: -500, error_note: 'Unauthorized' });

    if (req.method === 'POST' && path === '/payment/ofd_data/submit_items') {
      const fault = this.submitFaults.shift();
      if (fault) return send(200, fault);
      const id = String((body as { payment_id?: unknown }).payment_id);
      this.receipts.set(id, `https://ofd.soliq.uz/check?t=STUB${id}&r=1&c=20261112&s=1`);
      return send(200, { error_code: 0, error_note: 'Success' });
    }
    const m = /^\/payment\/ofd_data\/(\d+)\/(\d+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const link = this.receipts.get(m[2]!);
      if (!link || this.linkDelay > 0) {
        if (link) this.linkDelay--;
        return send(200, { paymentId: Number(m[2]), qrCodeURL: null });
      }
      return send(200, { paymentId: Number(m[2]), qrCodeURL: link });
    }
    return send(404, { error_code: -404, error_note: 'Not found' });
  }
}
