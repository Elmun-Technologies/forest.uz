/**
 * Outbound HTTP for integrations: per-attempt timeout, retries only for idempotent requests
 * (GET/HEAD/PUT/DELETE or explicitly marked), exponential backoff with jitter, honours
 * Retry-After on 429, and a per-integration circuit breaker so a dead provider doesn't stall queues.
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  /** POSTs are retried only when the provider guarantees idempotency (e.g. idempotency key). */
  idempotent?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

export interface HttpClientOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onAttempt?: (info: {
    url: string;
    method: string;
    status: number | null;
    attempt: number;
    ms: number;
    error?: string;
  }) => void;
}

export class CircuitOpenError extends Error {
  constructor(readonly integrationKey: string) {
    super(`circuit open for ${integrationKey}`);
  }
}

export class HttpClient {
  private failures = 0;
  private openUntil = 0;
  private readonly o: Required<Omit<HttpClientOptions, 'onAttempt'>> &
    Pick<HttpClientOptions, 'onAttempt'>;

  constructor(
    readonly integrationKey: string,
    options: HttpClientOptions = {},
  ) {
    this.o = {
      maxRetries: options.maxRetries ?? 3,
      baseDelayMs: options.baseDelayMs ?? 300,
      breakerThreshold: options.breakerThreshold ?? 5,
      breakerCooldownMs: options.breakerCooldownMs ?? 30_000,
      fetchImpl: options.fetchImpl ?? fetch,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: options.now ?? Date.now,
      onAttempt: options.onAttempt,
    };
  }

  get isOpen(): boolean {
    return this.o.now() < this.openUntil;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (this.isOpen) throw new CircuitOpenError(this.integrationKey);
    const retryable = req.idempotent ?? ['GET', 'HEAD', 'PUT', 'DELETE'].includes(req.method);
    const attempts = retryable ? this.o.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = this.o.now();
      try {
        const res = await this.o.fetchImpl(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body as RequestInit['body'],
          signal: AbortSignal.timeout(req.timeoutMs ?? 10_000),
        });
        const text = await res.text();
        this.o.onAttempt?.({
          url: req.url,
          method: req.method,
          status: res.status,
          attempt,
          ms: this.o.now() - started,
        });
        const transient = res.status === 429 || res.status >= 500;
        if (!transient) {
          this.recordSuccess();
          return { status: res.status, headers: res.headers, text };
        }
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt < attempts)
          await this.o.sleep(this.delay(attempt, res.headers.get('retry-after')));
      } catch (e) {
        lastError = e;
        this.o.onAttempt?.({
          url: req.url,
          method: req.method,
          status: null,
          attempt,
          ms: this.o.now() - started,
          error: String(e),
        });
        if (attempt < attempts) await this.o.sleep(this.delay(attempt, null));
      }
    }
    this.recordFailure();
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private delay(attempt: number, retryAfter: string | null): number {
    const ra = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 30_000);
    const exp = this.o.baseDelayMs * 2 ** (attempt - 1);
    return exp + Math.floor(Math.random() * this.o.baseDelayMs);
  }

  private recordSuccess(): void {
    this.failures = 0;
  }

  private recordFailure(): void {
    this.failures++;
    if (this.failures >= this.o.breakerThreshold) {
      this.openUntil = this.o.now() + this.o.breakerCooldownMs;
      this.failures = 0;
    }
  }
}
